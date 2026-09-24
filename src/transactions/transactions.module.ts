import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { ReceiptOcrService } from './receipt-ocr.service';

@Module({
  imports: [PrismaModule, NotificationsModule, ChatbotModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, ReceiptOcrService],
})
export class TransactionsModule {}
