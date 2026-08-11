import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { BudgetsService } from './budgets.service';
import type { BudgetPeriodFilter } from './budgets.service';
import { BudgetScope, CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
  };
};

@Controller('budgets')
@UseGuards(JwtGuard)
export class BudgetsController {
  constructor(private budgetsService: BudgetsService) {}

  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query('wallet_id') walletId?: string,
    @Query('scope') scope?: BudgetScope,
    @Query('q') query?: string,
    @Query('period_filter') periodFilter?: BudgetPeriodFilter,
    @Query('custom_start_date') customStartDate?: string,
    @Query('custom_end_date') customEndDate?: string,
    @Query('current_date') currentDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const shouldPaginate = page !== undefined || limit !== undefined;

    return shouldPaginate ||
      query ||
      periodFilter ||
      customStartDate ||
      customEndDate
      ? this.budgetsService.findAll(req.user.userId, {
          walletId: walletId ? Number(walletId) : undefined,
          scope,
          query,
          periodFilter,
          customStartDate,
          customEndDate,
          currentDate,
          page: page ? Number(page) : undefined,
          limit: limit ? Number(limit) : undefined,
        })
      : this.budgetsService.findAll(
          req.user.userId,
          walletId ? Number(walletId) : undefined,
          scope,
        );
  }

  @Get(':id')
  findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.budgetsService.findOne(req.user.userId, id);
  }

  @Get(':id/transactions')
  findTransactions(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.budgetsService.findTransactions(
      req.user.userId,
      id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 10,
    );
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateBudgetDto) {
    return this.budgetsService.create(req.user.userId, dto);
  }

  @Put(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.budgetsService.update(req.user.userId, id, dto);
  }

  @Post(':id/next-period')
  createNextPeriod(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.budgetsService.createNextPeriod(req.user.userId, id);
  }

  @Delete(':id')
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.budgetsService.remove(req.user.userId, id);
  }
}
