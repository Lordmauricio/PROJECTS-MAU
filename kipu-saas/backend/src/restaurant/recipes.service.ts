import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { money, ZERO_MONEY } from '../common/money';
import {
  SaveRecipeDto,
  PlanRecipeDto,
  RecipeRunActionDto,
} from './recipes.dto';
interface Ingredient {
  productId: string;
  name: string;
  inputUnit: string;
  quantity: string;
  toBaseFactor: string;
  baseUnit: string;
  baseQuantity: string;
  unitCost: string;
}
const digest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
function exactQuantity(value: Prisma.Decimal) {
  if (!value.eq(value.toDecimalPlaces(2)) || value.lte(0) || value.gt(1000000))
    throw new BadRequestException(
      'La conversión debe dar una cantidad positiva representable con 2 decimales de stock; ajusta la unidad base',
    );
  return value;
}
@Injectable()
export class RecipesService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly inventory: InventoryService,
  ) {}
  list(org: string) {
    return this.tenant.run(org, (tx) =>
      tx.recipe.findMany({
        where: { organizationId: org },
        include: { versions: { orderBy: { revision: 'desc' } } },
        orderBy: { name: 'asc' },
      }),
    );
  }
  runs(org: string, branchId?: string) {
    return this.tenant.run(org, (tx) =>
      tx.recipeRun.findMany({
        where: { organizationId: org, ...(branchId ? { branchId } : {}) },
        include: { recipeVersion: { select: { revision: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }
  save(org: string, actor: string, d: SaveRecipeDto, id?: string) {
    return this.tenant.run(org, async (tx) => {
      const requestHash = digest([
        id ?? null,
        d.expectedRevision ?? null,
        d.name,
        d.station,
        d.outputProductId,
        d.yieldQuantity,
        d.ingredients,
      ]);
      const versionId = 'rv_' + digest([org, d.requestKey]);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${org}),hashtext(${d.requestKey}))`;
      const previous = await tx.recipeVersion.findUnique({
        where: { id: versionId },
        include: { recipe: true },
      });
      if (previous) {
        const event = await tx.auditLog.findFirst({
          where: {
            organizationId: org,
            entityId: versionId,
            action: 'recipe.publish',
          },
        });
        const metadata = event?.metadata as { requestHash?: string } | null;
        if (metadata?.requestHash !== requestHash)
          throw new ConflictException('La clave pertenece a otra publicación');
        return { ...previous.recipe, versions: [previous] };
      }
      if (!d.name.trim() || !d.station.trim())
        throw new BadRequestException('Nombre y estación obligatorios');
      let revision = 1;
      if (id) {
        await tx.$queryRaw`SELECT id FROM recipes WHERE id=${id} AND "organizationId"=${org} FOR UPDATE`;
        const current = await tx.recipe.findFirst({
          where: { id, organizationId: org },
        });
        if (!current) throw new NotFoundException('Receta no encontrada');
        if (current.revision !== d.expectedRevision)
          throw new ConflictException(
            'La receta cambió. Actualiza antes de publicar',
          );
        revision = current.revision + 1;
      }
      const ids = [d.outputProductId, ...d.ingredients.map((i) => i.productId)];
      if (new Set(ids).size !== ids.length)
        throw new BadRequestException(
          'No repitas ingredientes ni uses el resultado como ingrediente',
        );
      const products = await tx.product.findMany({
        where: { organizationId: org, id: { in: ids }, active: true },
        include: { unit: true },
      });
      if (products.length !== ids.length)
        throw new BadRequestException(
          'Productos activos de esta empresa requeridos',
        );
      const byId = new Map(products.map((p) => [p.id, p]));
      if (d.ingredients.some((i) => !i.inputUnit.trim()))
        throw new BadRequestException('Unidad ingresada obligatoria');
      const ingredients: Ingredient[] = d.ingredients.map((i) => {
        const p = byId.get(i.productId)!;
        const quantity = new Prisma.Decimal(i.quantity);
        const factor = new Prisma.Decimal(i.toBaseFactor);
        return {
          productId: p.id,
          name: p.name,
          inputUnit: i.inputUnit.trim(),
          quantity: quantity.toFixed(4),
          toBaseFactor: factor.toFixed(6),
          baseUnit: p.unit?.symbol ?? 'u',
          baseQuantity: exactQuantity(quantity.mul(factor)).toFixed(2),
          unitCost: p.cost.toFixed(2),
        };
      });
      const total = money(
        ingredients.reduce(
          (s, i) => s.add(new Prisma.Decimal(i.baseQuantity).mul(i.unitCost)),
          ZERO_MONEY,
        ),
      );
      if (total.gt('9999999999.99'))
        throw new BadRequestException('Costo de receta fuera de rango');
      const recipe = id
        ? await tx.recipe.update({
            where: { id },
            data: { name: d.name.trim(), revision },
          })
        : await tx.recipe.create({
            data: { organizationId: org, name: d.name.trim() },
          });
      const output = byId.get(d.outputProductId)!;
      const version = await tx.recipeVersion.create({
        data: {
          id: versionId,
          organizationId: org,
          recipeId: recipe.id,
          revision,
          name: d.name.trim(),
          station: d.station.trim(),
          outputProductId: output.id,
          outputName: output.name,
          outputUnit: output.unit?.symbol ?? 'u',
          yieldQuantity: d.yieldQuantity,
          ingredients: ingredients as unknown as Prisma.InputJsonValue,
          theoreticalCost: total,
          createdById: actor,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org,
          userId: actor,
          action: 'recipe.publish',
          entityType: 'Recipe',
          entityId: version.id,
          metadata: { requestHash },
        },
      });
      return { ...recipe, versions: [version] };
    });
  }
  plan(org: string, actor: string, d: PlanRecipeDto) {
    const hash = digest([d.versionId, d.warehouseId, d.plannedQuantity]);
    return this.tenant.run(org, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${org}),hashtext(${d.requestKey}))`;
      const existing = await tx.recipeRun.findUnique({
        where: {
          organizationId_requestKey: {
            organizationId: org,
            requestKey: d.requestKey,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== hash)
          throw new ConflictException('Clave usada por otra producción');
        return existing;
      }
      const version = await tx.recipeVersion.findFirst({
        where: { id: d.versionId, organizationId: org },
        include: { recipe: true, outputProduct: { include: { unit: true } } },
      });
      const warehouse = await tx.warehouse.findFirst({
        where: { id: d.warehouseId, organizationId: org },
      });
      if (!version || !warehouse)
        throw new BadRequestException('Versión o almacén inválidos');
      if (
        !version.recipe.active ||
        version.revision !== version.recipe.revision
      )
        throw new ConflictException(
          'Usa la versión vigente para planificar una nueva producción',
        );
      if (
        !version.outputProduct.active ||
        version.outputUnit !== (version.outputProduct.unit?.symbol ?? 'u')
      )
        throw new ConflictException(
          'El producto preparado o su unidad cambiaron: publica una nueva receta',
        );
      const factor = new Prisma.Decimal(d.plannedQuantity).div(
        version.yieldQuantity,
      );
      const ingredients = version.ingredients as unknown as Ingredient[];
      const products = await tx.product.findMany({
        where: {
          organizationId: org,
          id: { in: ingredients.map((i) => i.productId) },
          active: true,
        },
        include: { unit: true },
      });
      if (
        products.length !== ingredients.length ||
        ingredients.some(
          (i) =>
            i.baseUnit !==
            (products.find((p) => p.id === i.productId)?.unit?.symbol ?? 'u'),
        )
      )
        throw new ConflictException(
          'Los ingredientes o unidades cambiaron: revisa la receta',
        );
      // Cost at planning is frozen separately from the version reference cost.
      const expected = ingredients.map((i) => ({
        ...i,
        baseQuantity: exactQuantity(
          new Prisma.Decimal(i.baseQuantity).mul(factor),
        ).toFixed(2),
        unitCost: products.find((p) => p.id === i.productId)!.cost.toFixed(2),
      }));
      const theoreticalCost = money(
        expected.reduce(
          (s, i) => s.add(new Prisma.Decimal(i.baseQuantity).mul(i.unitCost)),
          ZERO_MONEY,
        ),
      );
      if (theoreticalCost.gt('9999999999.99'))
        throw new BadRequestException('Costo de producción fuera de rango');
      const run = await tx.recipeRun.create({
        data: {
          organizationId: org,
          versionId: version.id,
          branchId: warehouse.branchId,
          warehouseId: warehouse.id,
          name: version.name,
          station: version.station,
          outputProductId: version.outputProductId,
          outputName: version.outputName,
          outputUnit: version.outputUnit,
          plannedQuantity: d.plannedQuantity,
          expectedInputs: expected,
          theoreticalCost,
          createdById: actor,
          requestKey: d.requestKey,
          requestHash: hash,
        },
      });
      await this.audit(tx, org, actor, run.id, 'recipe.plan');
      return run;
    });
  }
  action(org: string, actor: string, id: string, d: RecipeRunActionDto) {
    const hash = digest([
      d.version,
      d.status,
      d.actualInputs
        ? [...d.actualInputs].sort((a, b) =>
            a.productId.localeCompare(b.productId),
          )
        : null,
      d.producedQuantity ?? null,
      d.lotCode?.trim() ?? null,
      d.expiresOn ?? null,
      d.reason?.trim() ?? null,
    ]);
    return this.tenant.run(org, async (tx) => {
      await tx.$queryRaw`SELECT id FROM recipe_runs WHERE id=${id} AND "organizationId"=${org} FOR UPDATE`;
      const run = await tx.recipeRun.findFirst({
        where: { id, organizationId: org },
      });
      if (!run) throw new NotFoundException('Producción no encontrada');
      if (run.status === d.status && run.version === d.version + 1) {
        if (run.actionHash !== hash)
          throw new ConflictException(
            'El reintento cambia los datos de producción',
          );
        return run;
      }
      if (run.version !== d.version)
        throw new ConflictException('La producción cambió. Actualiza');
      const update: Prisma.RecipeRunUpdateInput = {
        status: d.status,
        version: { increment: 1 },
        actionHash: hash,
      };
      if (d.status === 'PREPARING') {
        if (run.status !== 'DRAFT')
          throw new ConflictException(
            'Solo se inicia una producción planificada',
          );
        const expected = run.expectedInputs as unknown as Ingredient[];
        if (
          d.actualInputs &&
          (new Set(d.actualInputs.map((i) => i.productId)).size !==
            expected.length ||
            d.actualInputs.length !== expected.length ||
            expected.some(
              (i) => !d.actualInputs!.some((a) => a.productId === i.productId),
            ))
        )
          throw new BadRequestException(
            'Indica todos los ingredientes una vez, en su unidad base',
          );
        const actual = expected.map((i) => ({
          ...i,
          baseQuantity: d.actualInputs
            ? money(
                d.actualInputs.find((a) => a.productId === i.productId)!
                  .quantity,
              ).toFixed(2)
            : i.baseQuantity,
        }));
        if (actual.every((i) => money(i.baseQuantity).eq(0)))
          throw new BadRequestException(
            'Debe consumirse al menos un ingrediente',
          );
        for (const input of actual.sort((a, b) =>
          a.productId.localeCompare(b.productId),
        ))
          if (money(input.baseQuantity).gt(0))
            await this.inventory.applyMovement(tx, {
              organizationId: org,
              warehouseId: run.warehouseId,
              productId: input.productId,
              type: 'OUT',
              direction: 'DECREASE',
              quantity: input.baseQuantity,
              reason: 'Receta iniciada',
              reference: id,
              userId: actor,
            });
        update.actualInputs = actual;
        update.actualCost = money(
          actual.reduce(
            (s, i) => s.add(new Prisma.Decimal(i.baseQuantity).mul(i.unitCost)),
            ZERO_MONEY,
          ),
        );
        if (
          new Prisma.Decimal(update.actualCost as Prisma.Decimal).gt(
            '9999999999.99',
          )
        )
          throw new BadRequestException('Costo real fuera de rango');
        update.startedAt = new Date();
      } else if (d.status === 'READY') {
        if (run.status !== 'PREPARING' || d.producedQuantity === undefined)
          throw new ConflictException('Inicia y registra el rendimiento real');
        if (d.expiresOn && !d.lotCode)
          throw new BadRequestException(
            'El vencimiento requiere lote preparado',
          );
        const produced = money(d.producedQuantity);
        if (run.actualCost!.div(produced).gt('99999999.9999'))
          throw new BadRequestException('Costo unitario fuera de rango');
        await this.inventory.applyMovement(tx, {
          organizationId: org,
          warehouseId: run.warehouseId,
          productId: run.outputProductId,
          type: 'IN',
          direction: 'INCREASE',
          quantity: produced,
          ...(d.lotCode
            ? {
                lotInputs: [
                  {
                    code: d.lotCode,
                    expiresOn: d.expiresOn,
                    quantity: produced.toFixed(2),
                  },
                ],
              }
            : {}),
          reason: 'Receta completada',
          reference: id,
          userId: actor,
        });
        update.producedQuantity = produced;
        update.readyAt = new Date();
        update.costPerUnit = run.actualCost!.div(produced).toDecimalPlaces(4);
      } else {
        if (!['DRAFT', 'PREPARING'].includes(run.status) || !d.reason?.trim())
          throw new BadRequestException(
            'Solo se cancela una producción pendiente, con motivo',
          );
        update.cancelReason = d.reason.trim();
      }
      const result = await tx.recipeRun.update({ where: { id }, data: update });
      await this.audit(tx, org, actor, id, `recipe.${d.status.toLowerCase()}`);
      return result;
    });
  }
  private audit(
    tx: Prisma.TransactionClient,
    org: string,
    actor: string,
    id: string,
    action: string,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId: org,
        userId: actor,
        action,
        entityType: 'Recipe',
        entityId: id,
      },
    });
  }
}
