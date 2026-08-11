import { Module } from '@nestjs/common';
import { CurrencyModule } from '../currency/currency.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LoanDebtsController } from './loan-debts.controller';
import { LoanDebtsService } from './loan-debts.service';

@Module({
  imports: [PrismaModule, CurrencyModule],
  controllers: [LoanDebtsController],
  providers: [LoanDebtsService],
  exports: [LoanDebtsService],
})
export class LoanDebtsModule {}
