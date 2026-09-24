import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module';
import { FinancialPlansModule } from '../financial-plans/financial-plans.module';
import { LoanDebtsModule } from '../loan-debts/loan-debts.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SavingsModule } from '../savings/savings.module';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { GeminiClient } from './gemini.client';

@Module({
  imports: [
    PrismaModule,
    BudgetsModule,
    LoanDebtsModule,
    SavingsModule,
    FinancialPlansModule,
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService, GeminiClient],
  exports: [GeminiClient],
})
export class ChatbotModule {}
