import { BadRequestException } from '@nestjs/common';

type Data = Record<string, unknown>;
const object = (v: unknown): Data => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail();
  return v as Data;
};
const fail = (): never => {
  throw new BadRequestException('Bản đồng bộ lịch chưa hợp lệ.');
};
const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const date = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^(20|21)\d{2}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const currency = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Z]{3}$/.test(v);
const money = (v: unknown, code: unknown) =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v > 0 &&
  v <= 9999999999999.99 &&
  (code === 'VND'
    ? Number.isInteger(v)
    : Math.abs(v * 100 - Math.round(v * 100)) < 0.00001);
const cycle = (v: unknown) =>
  ['WEEKLY', 'MONTHLY', 'YEARLY'].includes(String(v));
const list = (v: unknown, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) fail();
  return v as unknown[];
};
const unique = (set: Set<unknown>, value: unknown) => {
  if (set.has(value)) fail();
  set.add(value);
};
const due = (bill: Data, value: unknown): boolean => {
  if (!date(value) || !date(bill.anchorDate) || value < bill.anchorDate)
    return false;
  if (typeof bill.startDate === 'string' && value < bill.startDate)
    return false;
  const [y, m, d] = value.split('-').map(Number);
  const [ay, am, ad] = bill.anchorDate.split('-').map(Number);
  if (bill.cycle === 'WEEKLY')
    return (Date.parse(value) - Date.parse(bill.anchorDate)) % 604800000 === 0;
  const months = (y - ay) * 12 + m - am;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return (
    d === Math.min(ad, last) && (bill.cycle === 'MONTHLY' || months % 12 === 0)
  );
};
export const validatePlanningItems = (bookValue: unknown, plans: unknown) => {
  const book = object(bookValue),
    bills = new Map<unknown, Data>();
  for (const value of list(book.bills, 1000)) {
    const b = object(value);
    if (
      !text(b.id, 256) ||
      bills.has(b.id) ||
      !text(b.label, 100) ||
      !String(b.label).trim() ||
      !cycle(b.cycle) ||
      !date(b.anchorDate) ||
      !['FIXED', 'VARIABLE'].includes(String(b.kind)) ||
      !currency(b.currency) ||
      !money(b.minAmount, b.currency) ||
      !money(b.maxAmount, b.currency) ||
      Number(b.maxAmount) < Number(b.minAmount) ||
      (b.kind === 'FIXED' && b.minAmount !== b.maxAmount) ||
      typeof b.note !== 'string' ||
      b.note.length > 500 ||
      typeof b.paused !== 'boolean' ||
      typeof b.archived !== 'boolean' ||
      (b.reminderEnabled !== undefined &&
        typeof b.reminderEnabled !== 'boolean') ||
      (b.startDate !== undefined &&
        !due({ ...b, startDate: undefined }, b.startDate))
    )
      fail();
    bills.set(b.id, b);
  }
  const periods = new Set<unknown>(),
    payments = new Set<unknown>();
  for (const value of list(book.periods, 5000)) {
    const p = object(value),
      bill = bills.get(p.billId) ?? fail();
    if (!due(bill, p.dueDate)) fail();
    unique(periods, `${String(p.billId)}:${String(p.dueDate)}`);
    if (p.status === 'PAID') {
      const paid = object(p.payment);
      if (
        !Number.isSafeInteger(paid.id) ||
        Number(paid.id) <= 0 ||
        !money(paid.amount, bill.currency) ||
        paid.currency !== bill.currency ||
        !date(paid.date) ||
        typeof paid.note !== 'string' ||
        paid.note.length > 10000
      )
        fail();
      unique(payments, paid.id);
    } else if (p.status !== 'SKIPPED' || p.payment) fail();
  }
  const decisions = new Set<unknown>();
  for (const value of list(book.suggestions ?? [], 2000)) {
    const s = object(value);
    if (
      typeof s.key !== 'string' ||
      !/^bill-suggest:v1:[A-Z]{3}:(WEEKLY|MONTHLY|YEARLY):[a-z0-9 ]{3,160}$/.test(
        s.key,
      ) ||
      !['IGNORED', 'LATER', 'TRACKED'].includes(String(s.status)) ||
      (s.status === 'LATER' && !date(s.until)) ||
      (s.status === 'TRACKED' && !bills.has(s.billId))
    )
      fail();
    unique(decisions, s.key);
  }
  const alerts = new Set<unknown>();
  for (const value of list(book.reviewedAlerts ?? [], 2000)) {
    if (typeof value !== 'string' || value.length > 120000) fail();
    let parts: unknown;
    try {
      parts = JSON.parse(value as string);
    } catch {
      fail();
    }
    if (!Array.isArray(parts) || parts.length !== 10) fail();
    const a = parts as unknown[];
    if (
      a[0] !== 'bill-alert:v1' ||
      !['INCREASE', 'DUPLICATE'].includes(String(a[1])) ||
      !bills.has(a[2]) ||
      !cycle(a[3]) ||
      !currency(a[4]) ||
      !date(a[5]) ||
      !Number.isSafeInteger(a[6]) ||
      Number(a[6]) <= 0 ||
      typeof a[7] !== 'string' ||
      a[7].length > 160 ||
      !date(a[8])
    )
      fail();
    const ids = new Set<unknown>(),
      sources = list(a[9], 2000);
    if (sources.length < 2) fail();
    for (const row of sources) {
      if (
        !Array.isArray(row) ||
        row.length !== 3 ||
        !Number.isSafeInteger(row[0]) ||
        row[0] <= 0 ||
        row[0] > 2147483647 ||
        !date(row[1]) ||
        !Number.isSafeInteger(row[2]) ||
        row[2] <= 0
      )
        fail();
      unique(ids, (row as unknown[])[0]);
    }
    unique(alerts, value);
  }
  const ids = new Set<unknown>();
  for (const value of list(plans, 2000)) {
    const p = object(value);
    if (
      typeof p.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(p.id) ||
      !text(p.label, 100) ||
      !String(p.label).trim() ||
      !date(p.date) ||
      !['INCOME', 'EXPENSE'].includes(String(p.type)) ||
      !currency(p.currency) ||
      !money(p.amount, p.currency)
    )
      fail();
    unique(ids, p.id);
  }
};
