import { validate } from 'class-validator';
import { UpdateSavingsGoalDto } from './update-savings-goal.dto';
import { CreateWalletTransferDto } from './create-wallet-transfer.dto';

describe('Savings calendar dates', () => {
  it.each(['2026-02-29', '2026-04-31'])(
    'rejects an impossible target date %s',
    async (target_date) => {
      const errors = await validate(
        Object.assign(new UpdateSavingsGoalDto(), { target_date }),
      );
      expect(errors.some((error) => error.property === 'target_date')).toBe(
        true,
      );
    },
  );
  it('accepts a leap-day deadline and clearing the deadline', async () => {
    for (const target_date of ['2028-02-29', null]) {
      expect(
        await validate(
          Object.assign(new UpdateSavingsGoalDto(), { target_date }),
        ),
      ).toHaveLength(0);
    }
  });
  it('rejects a transfer date that would otherwise roll into the next month', async () => {
    const errors = await validate(
      Object.assign(new CreateWalletTransferDto(), {
        source_wallet_id: 1,
        destination_wallet_id: 2,
        amount: '100',
        transfer_date: '2026-02-30T00:00:00.000Z',
      }),
    );
    expect(errors.map((error) => error.property)).toEqual(['transfer_date']);
  });
});
