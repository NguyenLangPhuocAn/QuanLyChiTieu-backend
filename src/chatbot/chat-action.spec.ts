import { parseChatReply } from './chat-action';

describe('chat actions', () => {
  it('keeps analysis about receipts or transactions out of the entry flow', () => {
    expect(
      parseChatReply(
        JSON.stringify({
          intent: 'ANALYZE',
          message: 'Hóa đơn điện tăng 20%.',
          transaction: { type: 'EXPENSE', amount: 500000 },
        }),
      ),
    ).toEqual({ message: 'Hóa đơn điện tăng 20%.', action: null });
  });

  it('prepares a draft without claiming a financial write occurred', () => {
    const result = parseChatReply(
      JSON.stringify({
        intent: 'CREATE_TRANSACTION',
        message: 'Đã lưu!',
        transaction: {
          type: 'EXPENSE',
          amount: 30000,
          currency: 'VND',
          note: 'Ăn sáng',
          transaction_date: '2026-09-25',
        },
      }),
    );
    expect(result.action).toEqual({
      type: 'CREATE_TRANSACTION',
      draft: {
        type: 'EXPENSE',
        amount: 30000,
        currency: 'VND',
        note: 'Ăn sáng',
        transaction_date: '2026-09-25',
        wallet_name: null,
        category_name: null,
      },
    });
    expect(result.message).toContain('chưa được ghi sổ');
    expect(result.message).not.toContain('Đã lưu!');
  });

  it('routes image entry to the existing receipt picker', () => {
    expect(parseChatReply('{"intent":"SCAN_RECEIPT"}').action).toEqual({
      type: 'SCAN_RECEIPT',
    });
  });

  it.each([-10, 0, 1e15, '30000', null])(
    'leaves invalid amount %s empty instead of saving it',
    (amount) => {
      const result = parseChatReply(
        JSON.stringify({
          intent: 'CREATE_TRANSACTION',
          transaction: {
            type: 'INCOME',
            amount,
            transaction_date: '2026-02-30',
            currency: '<script>',
          },
        }),
      );
      expect(result.action).toMatchObject({
        type: 'CREATE_TRANSACTION',
        draft: { amount: null, transaction_date: null, currency: null },
      });
    },
  );

  it.each([
    '{"intent":"DELETE_TRANSACTION"}',
    '{"intent":"CREATE_TRANSACTION","transaction":{"type":"TRANSFER"}}',
    '{"intent":',
    'null',
    '[]',
  ])('does not execute malformed/unsupported output %s', (raw) => {
    expect(parseChatReply(raw).action).toBeNull();
  });
});
