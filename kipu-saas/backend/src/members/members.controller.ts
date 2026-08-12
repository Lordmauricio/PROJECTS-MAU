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
  @RequirePermissions('users.manage')
  invite(@CurrentAuth() auth: AccessTokenPayload, @Body() dto: InviteMemberDto) {
    return this.members.invite(auth.organizationId, dto, auth.sub);
  }

  @Patch(':id/role')
  @RequirePermissions('users.manage')
  changeRole(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ChangeMemberRoleDto,
  ) {
    return this.members.changeRole(auth.organizationId, id, dto.roleId, auth.sub);
  }

  @Patch(':id/suspend')
  @RequirePermissions('users.manage')
  suspend(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.members.setStatus(auth.organizationId, id, 'SUSPENDED', auth.sub);
  }

  @Patch(':id/reactivate')
  @RequirePermissions('users.manage')
  reactivate(@CurrentAuth() auth: AccessTokenPayload, @Param('id') id: string) {
    return this.members.setStatus(auth.organizationId, id, 'ACTIVE', auth.sub);
  }
}
