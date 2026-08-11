import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsAdminController } from './notifications-admin.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsScheduler } from './notifications.scheduler';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PrismaModule, BudgetsModule],
  controllers: [NotificationsController, NotificationsAdminController],
  providers: [NotificationsService, NotificationsScheduler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
