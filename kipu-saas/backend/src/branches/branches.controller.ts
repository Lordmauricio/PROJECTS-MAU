import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@Controller('branches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequirePermissions('organization.branches.read')
  list(@CurrentAuth() auth: AccessTokenPayload) {
    return this.branches.list(auth.organizationId);
  }

  @Post()
  @RequirePermissions('organization.branches.manage')
  create(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: CreateBranchDto) {
    return this.branches.create(auth.organizationId, dto, auth.sub);
  }

  @Patch(':id')
  @RequirePermissions('organization.branches.manage')
  update(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branches.update(auth.organizationId, id, dto, auth.sub);
  }
}
