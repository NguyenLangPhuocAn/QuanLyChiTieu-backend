import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @Cron('0 8 * * *')
  async createExpiringBudgetNotifications() {
    try {
      const result =
        await this.notificationsService.createExpiringBudgetNotifications();

      this.logger.log(
        `Expiring budget notifications scanned=${result.scannedCount} created=${result.createdCount}`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to create expiring budget notifications',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  @Cron('5 8 * * *')
  async createFinancialPlanNotifications() {
    try {
      const result =
        await this.notificationsService.createFinancialPlanNotifications();
      this.logger.log(
        `Financial plan notifications scanned=${result.scannedCount} created=${result.createdCount}`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to create financial plan notifications',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
