import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * `updatedSince` (Offline 4.3, sincronización incremental de catálogo).
   * A diferencia de productos, este `list()` NUNCA filtró por `active` —
   * los clientes desactivados ya se devolvían siempre, así que no hace
   * falta ningún bypass acá. `updatedAt >= updatedSince` (nunca `>`
   * estricto) por la misma razón que en `ProductsService.list`: evita
   * perder una fila que comparte instante exacto con el cursor. El orden
   * pasa a `updatedAt asc` (en vez de `createdAt desc`) para que el
   * cliente pueda paginar avanzando su propio cursor de forma segura.
   */
  list(
    organizationId: string,
    query?: { search?: string; updatedSince?: string },
  ) {
    const search = query?.search;
    const updatedSince = query?.updatedSince;
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.customer.findMany({
        where: {
          organizationId,
          ...(updatedSince
            ? { updatedAt: { gte: new Date(updatedSince) } }
            : {}),
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { documentNumber: { contains: search } },
                ],
              }
            : {}),
        },
        orderBy: updatedSince ? { updatedAt: 'asc' } : { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  // "Mostrar: compras, facturas, pagos, cuenta corriente" (sección 10). Los
  // módulos de ventas/facturación todavía no tienen lógica de negocio en
  // esta fase, así que estas listas dan vacío hasta que exista actividad
  // real — nunca datos de ejemplo.
  async findOne(organizationId: string, customerId: string) {
    return this.tenantPrisma.run(organizationId, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, organizationId },
        include: {
          sales: { orderBy: { createdAt: 'desc' }, take: 20 },
          invoices: { orderBy: { issuedAt: 'desc' }, take: 20 },
          receivables: { orderBy: { dueDate: 'asc' } },
        },
      });
      if (!customer) throw new NotFoundException('Cliente no encontrado');
      return customer;
    });
  }

  async create(
    organizationId: string,
    dto: CreateCustomerDto,
    actorUserId: string,
  ) {
    const customer = await this.tenantPrisma.run(organizationId, (tx) =>
      tx.customer.create({ data: { organizationId, ...dto } }),
    );
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'customers.create',
      entityType: 'Customer',
      entityId: customer.id,
    });
    return customer;
  }

  async update(
    organizationId: string,
    customerId: string,
    dto: UpdateCustomerDto,
    actorUserId: string,
  ) {
    const updated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = await tx.customer.findFirst({
        where: { id: customerId, organizationId },
      });
      if (!existing) throw new NotFoundException('Cliente no encontrado');
      return tx.customer.update({ where: { id: customerId }, data: dto });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'customers.update',
      entityType: 'Customer',
      entityId: customerId,
    });
    return updated;
  }
}
