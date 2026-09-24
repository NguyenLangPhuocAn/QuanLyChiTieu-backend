import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { FinancialPlansService } from './financial-plans.service';

type AuthenticatedRequest = Request & { user: { userId: number } };

@Controller('financial-plans')
@UseGuards(JwtGuard)
export class FinancialPlansController {
  constructor(private readonly financialPlansService: FinancialPlansService) {}

  @Get('overview')
  overview(@Req() req: AuthenticatedRequest) {
    return this.financialPlansService.getOverview(req.user.userId);
  }
}
