import { getCashFlowType } from './cash-flow-classification';

describe('cash-flow classification', () => {
  it('uses category cash_flow_group before falling back to name or icon guesses', () => {
    expect(
      getCashFlowType({
        name: 'Food',
        icon: 'categories/icons/expense_food.png',
        cash_flow_group: 'LOAN_DEBT',
      }),
    ).toBe('loan_debt');
    expect(
      getCashFlowType({
        name: 'Debt-looking normal category',
        icon: 'categories/icons/expense_debt_payment.png',
        cash_flow_group: 'NORMAL',
      }),
    ).toBe('normal');
  });
});
