import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantPrismaService } from './tenant-prisma.service';

@Global()
@Module({
  providers: [PrismaService, TenantPrismaService],
  exports: [PrismaService, TenantPrismaService],
})
export class PrismaModule {}
