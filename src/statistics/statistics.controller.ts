import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { ReportsService } from './reports.service';
import type { ReportPeriod } from './reports.service';
import { StatisticsService } from './statistics.service';
import type { StatisticsPeriod } from './statistics.service';

type AuthenticatedRequest = Request & {
  user: {
    userId: number;
    role?: string | null;
  };
};

@Controller('statistics')
@UseGuards(JwtGuard)
export class StatisticsController {
  constructor(
    private statisticsService: StatisticsService,
    private reportsService: ReportsService,
  ) {}

  private assertPremiumStatistics(role?: string | null) {
    if (role !== 'PREMIUM' && role !== 'ADMIN') {
      throw new ForbiddenException(
        'Thống kê nâng cao chỉ dành cho tài khoản Premium',
      );
    }
  }

  @Get()
  getStatistics(
    @Req() req: AuthenticatedRequest,
    @Query('period') period?: StatisticsPeriod,
  ) {
    if (period && !['all', 'day', 'week', 'month', 'year'].includes(period)) {
      throw new BadRequestException('Kỳ thống kê không hợp lệ');
    }

    this.assertPremiumStatistics(req.user.role);

    return this.statisticsService.getUserStatistics(
      req.user.userId,
      period ?? 'month',
    );
  }

  @Get('report')
  exportReport(
    @Req() req: AuthenticatedRequest,
    @Query('period') period?: ReportPeriod,
    @Query('format') format?: 'excel' | 'pdf',
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    if (
      period &&
      !['all', 'day', 'week', 'month', 'quarter', 'year', 'custom'].includes(
        period,
      )
    ) {
      throw new BadRequestException('Kỳ thống kê không hợp lệ');
    }

    if (format && !['excel', 'pdf'].includes(format)) {
      throw new BadRequestException('Định dạng báo cáo không hợp lệ');
    }

    return this.reportsService.exportReport(
      req.user.userId,
      req.user.role ?? null,
      period ?? 'month',
      format ?? 'excel',
      { dateFrom, dateTo },
    );
  }

  @Post('report/email')
  sendExcelReport(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      email?: string;
      period?: ReportPeriod;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    if (
      body.period &&
      !['all', 'day', 'week', 'month', 'quarter', 'year', 'custom'].includes(
        body.period,
      )
    ) {
      throw new BadRequestException('Kỳ thống kê không hợp lệ');
    }

    if (!body.email) {
      throw new BadRequestException('Vui lòng nhập email nhận báo cáo');
    }

    return this.reportsService.sendExcelReport(
      req.user.userId,
      req.user.role ?? null,
      body.period ?? 'month',
      body.email,
      { dateFrom: body.dateFrom, dateTo: body.dateTo },
    );
  }
}
