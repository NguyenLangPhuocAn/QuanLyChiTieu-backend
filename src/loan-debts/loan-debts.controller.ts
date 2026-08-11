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
import { CreateLoanDebtPaymentDto } from './dto/create-loan-debt-payment.dto';
import { CreateLoanDebtDto, LoanDebtType } from './dto/create-loan-debt.dto';
import { UpdateLoanDebtDto } from './dto/update-loan-debt.dto';
import { LoanDebtsService } from './loan-debts.service';

type AuthRequest = Request & { user: { userId: number } };

@Controller('loan-debts')
@UseGuards(JwtGuard)
export class LoanDebtsController {
  constructor(private service: LoanDebtsService) {}

  @Get()
  findAll(
    @Req() req: AuthRequest,
    @Query('type') type?: LoanDebtType,
    @Query('status') status?: 'OPEN' | 'OVERDUE' | 'PAID',
  ) {
    return this.service.findAll(req.user.userId, { type, status });
  }

  @Get(':id')
  findOne(@Req() req: AuthRequest, @Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(req.user.userId, id);
  }

  @Post()
  create(@Req() req: AuthRequest, @Body() dto: CreateLoanDebtDto) {
    return this.service.create(req.user.userId, dto);
  }

  @Put(':id')
  update(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLoanDebtDto,
  ) {
    return this.service.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: AuthRequest, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(req.user.userId, id);
  }

  @Post(':id/payments')
  addPayment(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateLoanDebtPaymentDto,
  ) {
    return this.service.addPayment(req.user.userId, id, dto);
  }

  @Delete(':id/payments/:paymentId')
  removePayment(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ) {
    return this.service.removePayment(req.user.userId, id, paymentId);
  }
}
