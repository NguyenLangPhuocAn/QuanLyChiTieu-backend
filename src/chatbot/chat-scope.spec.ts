import {
  isClearlyOutsideFinancialScope,
  OUT_OF_SCOPE_REPLY,
} from './chat-scope';

describe('chatbot financial scope', () => {
  it.each([
    '1+1 = ?',
    'Một cộng một bằng bao nhiêu?',
    'Viết code Python giúp tôi',
  ])('rejects a clearly unrelated request: %s', (message) => {
    expect(isClearlyOutsideFinancialScope(message)).toBe(true);
    expect(OUT_OF_SCOPE_REPLY).toContain('quản lý thu chi');
  });

  it.each([
    'Tháng này tôi chi bao nhiêu?',
    'Ghi tiền ăn sáng 30 nghìn',
    'Mã giao dịch ngân hàng nằm ở đâu?',
    'Tôi nên chia ngân sách thế nào?',
  ])('keeps a financial request in scope: %s', (message) => {
    expect(isClearlyOutsideFinancialScope(message)).toBe(false);
  });
});
