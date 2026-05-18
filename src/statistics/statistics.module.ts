import { Module } from '@nestjs/common';
import { CurrencyModule } from '../currency/currency.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportsService } from './reports.service';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';

@Module({
  imports: [PrismaModule, CurrencyModule],
  controllers: [StatisticsController],
  providers: [StatisticsService, ReportsService],
  exports: [StatisticsService, ReportsService],
})
export class StatisticsModule {}
