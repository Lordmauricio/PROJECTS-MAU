import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAuth } from '../common/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.service';
import { CashService } from './cash.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ListExpensesQueryDto } from './dto/list-cash-registers-query.dto';

@Controller('expenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExpensesController {
  constructor(private readonly cash: CashService) {}

  @Get()
  @RequirePermissions('expenses.read')
  list(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ListExpensesQueryDto,
  ) {
    return this.cash.listExpenses(auth.organizationId, query);
  }

  @Post()
  @RequirePermissions('expenses.manage')
  create(
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.cash.registerExpense(auth.organizationId, dto, auth.sub);
  }
}
