export const OUT_OF_SCOPE_REPLY =
  'Mình chỉ hỗ trợ quản lý thu chi và tài chính cá nhân trong ứng dụng. Bạn có thể hỏi về giao dịch, ví, ngân sách, tiết kiệm, vay nợ, hóa đơn hoặc kế hoạch tài chính.';

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .trim();

const programmingTerms = [
  'code python',
  'viet code',
  'lap trinh',
  'javascript',
  'typescript',
  'python',
  'java ',
  'c++',
  'c#',
  'source code',
  'html',
  'css',
  'react native',
  'thuat toan',
];

const standaloneArithmetic =
  /^[\s\d.,()+\-*/x×÷=?:]+$|^(?:mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi)\s+(?:cong|tru|nhan|chia)\s+(?:mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi)(?:\s+(?:bang|la)\s+(?:bao nhieu|gi))?[?\s]*$/;

export const isClearlyOutsideFinancialScope = (message: string) => {
  const normalized = normalize(message);
  return (
    standaloneArithmetic.test(normalized) ||
    programmingTerms.some((term) => normalized.includes(term))
  );
};
