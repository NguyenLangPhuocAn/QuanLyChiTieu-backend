export type CashFlowType = 'normal' | 'loan_debt';

type ClassifiableCategory = {
  name?: string | null;
  icon?: string | null;
  cash_flow_group?: string | null;
};

const normalizeText = (value?: string | null) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export const isLoanDebtCategory = (category?: ClassifiableCategory | null) => {
  if (category?.cash_flow_group) {
    return normalizeText(category.cash_flow_group) === 'loan_debt';
  }

  const name = normalizeText(category?.name);
  const icon = normalizeText(category?.icon);
  const combined = `${name} ${icon}`;

  return (
    combined.includes('loan') ||
    combined.includes('debt') ||
    combined.includes('vay') ||
    combined.includes('tra no') ||
    combined.includes('thu no') ||
    combined === 'no' ||
    combined.includes(' no ')
  );
};

export const getCashFlowType = (
  category?: ClassifiableCategory | null,
): CashFlowType => (isLoanDebtCategory(category) ? 'loan_debt' : 'normal');

export const isNormalCashFlow = (category?: ClassifiableCategory | null) =>
  getCashFlowType(category) === 'normal';
