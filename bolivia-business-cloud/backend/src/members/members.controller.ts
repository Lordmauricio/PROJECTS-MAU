import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { MembersService } from './members.service';
import { ChangeMemberRoleDto, InviteMemberDto } from './dto/invite-member.dto';

@Controller('members')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@CurrentAuth() auth: AccessTokenPayload) {
    return this.members.list(auth.organizationId);
  }

  @Post('invite')
  @RequirePermissions('organization.users.manage')
  invite(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: InviteMemberDto) {
    return this.members.invite(auth.organizationId, dto);
  }

  @Patch(':id/role')
  @RequirePermissions('organization.users.manage')
  changeRole(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ChangeMemberRoleDto,
  ) {
    return this.members.changeRole(auth.organizationId, id, dto.roleId);
  }

  @Patch(':id/suspend')
  @RequirePermissions('organization.users.manage')
  suspend(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.members.setStatus(auth.organizationId, id, 'SUSPENDED');
  }

  @Patch(':id/reactivate')
  @RequirePermissions('organization.users.manage')
  reactivate(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.members.setStatus(auth.organizationId, id, 'ACTIVE');
  }
}
