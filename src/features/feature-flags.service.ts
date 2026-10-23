import { Injectable } from '@nestjs/common';

@Injectable()
export class FeatureFlagsService {
  // Snapshot at startup. Editing .env takes effect only after a planned restart.
  private readonly bankNotificationAi =
    process.env.FEATURE_BANK_NOTIFICATION_AI?.trim().toLowerCase() === 'true';

  isBankNotificationAiEnabled() {
    return this.bankNotificationAi;
  }

  publicFlags() {
    return { bank_notification_ai: this.bankNotificationAi };
  }
}
