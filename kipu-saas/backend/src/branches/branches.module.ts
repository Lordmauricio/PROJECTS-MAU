import { Module } from '@nestjs/common';
import { BranchesService } from './branches.service';
import { BranchesController } from './branches.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [BranchesService],
  controllers: [BranchesController],
  exports: [BranchesService],
})
export class BranchesModule {}
