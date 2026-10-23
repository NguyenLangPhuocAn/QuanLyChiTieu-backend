import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { FeaturesModule } from '../features/features.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BankNotificationsController } from './bank-notifications.controller';
import { BankNotificationExtractionService } from './bank-notification-extraction.service';

@Module({
  imports: [ChatbotModule, FeaturesModule, PrismaModule],
  controllers: [BankNotificationsController],
  providers: [BankNotificationExtractionService],
})
export class BankNotificationsModule {}
