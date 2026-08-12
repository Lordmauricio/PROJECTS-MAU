import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePOSTerminalDto, UpdatePOSTerminalDto } from './dto/pos-terminal.dto';

@Injectable()
export class POSTerminalsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string) {
    return this.tenantPrisma.run(organizationId, (tx) =>
      tx.pOSTerminal.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } }),
    );
  }

  async create(organizationId: string, dto: CreatePOSTerminalDto, actorUserId: string) {
    const terminal = await this.tenantPrisma.run(organizationId, async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: dto.branchId, organizationId } });
      if (!branch) throw new NotFoundException('Sucursal no encontrada');

      const existing = await tx.pOSTerminal.findFirst({ where: { branchId: dto.branchId, code: dto.code } });
      if (existing) throw new ConflictException('Ya existe un punto de venta con ese código en la sucursal');

      return tx.pOSTerminal.create({
        data: { organizationId, branchId: dto.branchId, name: dto.name, code: dto.code },
      });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'pos_terminals.create',
      entityType: 'POSTerminal',
      entityId: terminal.id,
    });
    return terminal;
  }

  async update(organizationId: string, terminalId: string, dto: UpdatePOSTerminalDto, actorUserId: string) {
    const updated = await this.tenantPrisma.run(organizationId, async (tx) => {
      const existing = await tx.pOSTerminal.findFirst({ where: { id: terminalId, organizationId } });
      if (!existing) throw new NotFoundException('Punto de venta no encontrado');
      return tx.pOSTerminal.update({ where: { id: terminalId }, data: dto });
    });
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'pos_terminals.update',
      entityType: 'POSTerminal',
      entityId: terminalId,
    });
    return updated;
  }
}
