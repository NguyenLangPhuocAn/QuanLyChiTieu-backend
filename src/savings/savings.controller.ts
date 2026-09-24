import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { CreateSavingsGoalDto } from './dto/create-savings-goal.dto';
import {
  AddSavingsContributionDto,
  WithdrawSavingsDto,
} from './dto/savings-entry.dto';
import { UpdateSavingsGoalDto } from './dto/update-savings-goal.dto';
import { SavingsService } from './savings.service';

type AuthRequest = Request & { user: { userId: number } };

@Controller('savings-goals')
@UseGuards(JwtGuard)
export class SavingsController {
  constructor(private readonly savingsService: SavingsService) {}

  @Get()
  findAll(@Req() req: AuthRequest) {
    return this.savingsService.findAll(req.user.userId);
  }

  @Get('context')
  getContext(@Req() req: AuthRequest) {
    return this.savingsService.getAssistantContext(req.user.userId);
  }

  @Get(':id')
  findOne(@Req() req: AuthRequest, @Param('id', ParseIntPipe) id: number) {
    return this.savingsService.findOne(req.user.userId, id);
  }

  @Post()
  create(@Req() req: AuthRequest, @Body() dto: CreateSavingsGoalDto) {
    return this.savingsService.createGoal(req.user.userId, dto);
  }

  @Put(':id')
  update(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSavingsGoalDto,
  ) {
    return this.savingsService.updateGoal(req.user.userId, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: AuthRequest, @Param('id', ParseIntPipe) id: number) {
    return this.savingsService.removeGoal(req.user.userId, id);
  }

  @Post(':id/contributions')
  contribute(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddSavingsContributionDto,
  ) {
    return this.savingsService.contribute(req.user.userId, id, dto);
  }

  @Post(':id/withdrawals')
  withdraw(
    @Req() req: AuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WithdrawSavingsDto,
  ) {
    return this.savingsService.withdraw(req.user.userId, id, dto);
  }
}
