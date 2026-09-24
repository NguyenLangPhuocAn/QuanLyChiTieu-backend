import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsBoolean()
  budget_alerts_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  budget_expiring_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  cashflow_forecast_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  savings_plan_alerts_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  system_notifications_enabled?: boolean;
}
