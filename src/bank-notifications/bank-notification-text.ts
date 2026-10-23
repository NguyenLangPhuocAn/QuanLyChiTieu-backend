import { BadRequestException } from '@nestjs/common';

export type VisibleMoney = {
  amount: number;
  currency: 'VND' | 'USD';
  direction: 'INCOME' | 'EXPENSE' | null;
  raw: string;
};

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();
const moneyPattern =
  /([+-]?\s*\d(?:[\d.,]{0,19}\d)?)\s*(vnd|vnđ|đ|₫|usd)(?=\s|$|[).,;])|(?:\(\s*)?\b(vnd|vnđ|usd)\b\s*\)?\s*([+-]?\s*\d(?:[\d.,]{0,19}\d)?)/giu;

function stripBalances(input: string) {
  const labels =
    /số\s*dư|so\s*du|\bsodu\b|\bsd(?:tk)?\b|\bavailable(?:\s+balance)?\b|\bbalance\b|khả dụng|kha dung/giu;
  let cursor = 0;
  let output = '';
  for (const label of input.matchAll(labels)) {
    const start = label.index;
    if (start < cursor) continue;
    const prefix = normalize(input.slice(Math.max(0, start - 35), start));
    // The title "Thông báo thay đổi số dư" is not itself a balance value.
    if (/(?:bien dong|thay doi|changes? (?:to|in))\s*$/.test(prefix)) continue;
    const afterLabel = start + label[0].length;
    const tail = input.slice(afterLabel);
    // Decimal/grouping periods stay in the clause; a period before a new sentence ends it.
    const leadingWhitespace = tail.length - tail.trimStart().length;
    const boundary = tail
      .slice(leadingWhitespace)
      .search(/[;\r\n]|[.!?](?=\s+(?:\p{L}|\[)|$)/u);
    const end =
      boundary < 0 ? input.length : afterLabel + leadingWhitespace + boundary;
    output += `${input.slice(cursor, start)}[ĐÃ BỎ SỐ DƯ]`;
    cursor = end;
  }
  return output + input.slice(cursor);
}

export function directionInEvidence(text: string): 'INCOME' | 'EXPENSE' | null {
  const plain = normalize(text);
  const incoming =
    /\+\s*\d|\b(nhan tien|nhan duoc|ghi co|tien vao|duoc cong|tang|credit)\b/.test(
      plain,
    );
  const outgoing =
    /-\s*\d|\b(ghi no|tien ra|bi tru|giam|thanh toan|chi tieu|chuyen di|rut tien|debit)\b/.test(
      plain,
    );
  return incoming === outgoing ? null : incoming ? 'INCOME' : 'EXPENSE';
}

export function readVisibleMoney(text: string): VisibleMoney[] {
  return Array.from(text.matchAll(moneyPattern)).flatMap((match) => {
    const number = (match[1] ?? match[4]).replace(/\s/g, '');
    const currency =
      (match[2] ?? match[3]).toUpperCase() === 'USD' ? 'USD' : 'VND';
    const unsigned = number.replace(/^[+-]/, '');
    // VND is integer-valued; a foreign decimal is preserved, not stripped.
    let normalized: string;
    if (currency === 'VND') {
      if (
        !/^\d+$/.test(unsigned) &&
        !/^\d{1,3}(?:\.\d{3})+$/.test(unsigned) &&
        !/^\d{1,3}(?:,\d{3})+$/.test(unsigned)
      )
        return [];
      normalized = unsigned.replace(/[.,]/g, '');
    } else {
      const decimal =
        unsigned.match(/^(\d+(?:,\d{3})*)\.(\d{1,2})$/) ??
        unsigned.match(/^(\d+(?:\.\d{3})*),(\d{1,2})$/);
      if (decimal)
        normalized = `${decimal[1].replace(/[.,]/g, '')}.${decimal[2]}`;
      else if (
        /^\d+$/.test(unsigned) ||
        /^\d{1,3}(?:,\d{3})+$/.test(unsigned) ||
        /^\d{1,3}(?:\.\d{3})+$/.test(unsigned)
      )
        normalized = unsigned.replace(/[.,]/g, '');
      else return [];
    }
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) return [];
    return [
      {
        amount,
        currency,
        raw: match[0].trim(),
        direction: number.startsWith('+')
          ? 'INCOME'
          : number.startsWith('-')
            ? 'EXPENSE'
            : null,
      },
    ];
  });
}

/** Only this sanitized text may be sent upstream. No raw input is logged or persisted. */
export function prepareBankNotificationText(input: string) {
  if (
    typeof input !== 'string' ||
    input.length > 800 ||
    input.trim().length < 5
  ) {
    throw new BadRequestException(
      'Nội dung thông báo phải từ 5 đến 800 ký tự.',
    );
  }
  const plain = normalize(input);
  if (
    /\b(otp|password|mat khau|ma xac thuc|verification code|pin code)\b/.test(
      plain,
    )
  ) {
    throw new BadRequestException(
      'Không gửi thông báo OTP, mật khẩu hoặc mã xác thực để phân tích.',
    );
  }
  let text = stripBalances(input)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(
      /((?:tài khoản|tai khoan|số tài khoản|so tai khoan|stk|tk|account|card|số thẻ|so the)\s*[:#=]?\s*)[\d*][\d* ]{2,24}/giu,
      '$1[ĐÃ CHE]',
    )
    .replace(
      /(?:\bGD|\bref|reference|mã giao dịch|ma giao dich|transaction id)\s*[:#=]\s*[\p{L}\d_-]+/giu,
      '[ĐÃ CHE MÃ GD]',
    );

  // Protect monetary literals while hiding unlabeled long account/reference IDs.
  const protectedMoney: string[] = [];
  text = text.replace(moneyPattern, (value) => {
    protectedMoney.push(value);
    return `__MONEY_${String.fromCharCode(65 + protectedMoney.length - 1)}__`;
  });
  text = text.replace(/\b[\p{L}\d_-]*\d[\p{L}\d_-]{7,}\b/gu, '[ĐÃ CHE MÃ]');
  protectedMoney.forEach((value, index) => {
    text = text.replace(`__MONEY_${String.fromCharCode(65 + index)}__`, value);
  });
  return { text, money: readVisibleMoney(text) };
}
