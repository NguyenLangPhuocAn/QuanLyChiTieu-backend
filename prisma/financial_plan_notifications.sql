ALTER TABLE notification_settings
  ADD COLUMN cashflow_forecast_enabled BOOLEAN DEFAULT TRUE AFTER budget_expiring_enabled,
  ADD COLUMN savings_plan_alerts_enabled BOOLEAN DEFAULT TRUE AFTER cashflow_forecast_enabled;
