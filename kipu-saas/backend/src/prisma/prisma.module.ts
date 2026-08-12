import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantPrismaService } from './tenant-prisma.service';
import { UserPrismaService } from './user-prisma.service';

@Global()
@Module({
  providers: [PrismaService, TenantPrismaService, UserPrismaService],
  exports: [PrismaService, TenantPrismaService, UserPrismaService],
})
export class PrismaModule {}
