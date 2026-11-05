import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RecipesService } from './recipes.service';
import {
  SaveRecipeDto,
  PlanRecipeDto,
  RecipeRunActionDto,
} from './recipes.dto';
@Controller('restaurant/recipes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}
  @Get() @RequirePermissions('inventory.read') list(
    @CurrentAuth() a: AccessTokenPayload,
  ) {
    return this.recipes.list(a.organizationId);
  }
  @Post() @RequirePermissions('inventory.manage') create(
    @CurrentAuth() a: AccessTokenPayload,
    @Body() d: SaveRecipeDto,
  ) {
    return this.recipes.save(a.organizationId, a.sub, d);
  }
  @Patch(':id') @RequirePermissions('inventory.manage') update(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
    @Body() d: SaveRecipeDto,
  ) {
    return this.recipes.save(a.organizationId, a.sub, d, id);
  }
  @Get('runs') @RequirePermissions('inventory.read') runs(
    @CurrentAuth() a: AccessTokenPayload,
    @Query('branchId') b?: string,
  ) {
    return this.recipes.runs(a.organizationId, b);
  }
  @Post('runs') @RequirePermissions('inventory.manage') plan(
    @CurrentAuth() a: AccessTokenPayload,
    @Body() d: PlanRecipeDto,
  ) {
    return this.recipes.plan(a.organizationId, a.sub, d);
  }
  @Post('runs/:id/status') @RequirePermissions('inventory.manage') action(
    @CurrentAuth() a: AccessTokenPayload,
    @Param('id') id: string,
    @Body() d: RecipeRunActionDto,
  ) {
    return this.recipes.action(a.organizationId, a.sub, id, d);
  }
}
