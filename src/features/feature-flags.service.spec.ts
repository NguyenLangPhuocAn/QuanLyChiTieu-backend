import { FeatureFlagsService } from './feature-flags.service';

describe('feature flags', () => {
  const saved = process.env.FEATURE_BANK_NOTIFICATION_AI;
  afterEach(() => {
    if (saved === undefined) delete process.env.FEATURE_BANK_NOTIFICATION_AI;
    else process.env.FEATURE_BANK_NOTIFICATION_AI = saved;
  });
  it.each([undefined, '', 'false', '1', 'yes', 'tru'])(
    'keeps bank extraction off for %s',
    (value) => {
      if (value === undefined) delete process.env.FEATURE_BANK_NOTIFICATION_AI;
      else process.env.FEATURE_BANK_NOTIFICATION_AI = value;
      expect(new FeatureFlagsService().publicFlags()).toEqual({
        bank_notification_ai: false,
      });
    },
  );
  it('only publishes a whitelist and snapshots startup settings', () => {
    process.env.FEATURE_BANK_NOTIFICATION_AI = ' TRUE ';
    const flags = new FeatureFlagsService();
    process.env.FEATURE_BANK_NOTIFICATION_AI = 'false';
    expect(flags.publicFlags()).toEqual({ bank_notification_ai: true });
    expect(new FeatureFlagsService().isBankNotificationAiEnabled()).toBe(false);
  });
});
