import { parseQueryInteger } from './parse-query-integer';

describe('transaction query integers', () => {
  it.each([
    'abc',
    'NaN',
    'Infinity',
    '0',
    '-1',
    '1.5',
    '',
    '1e3',
    '9007199254740992',
  ])('rejects invalid query value %s', (value) => {
    expect(() => parseQueryInteger(value, 'Trang')).toThrow('số nguyên dương');
  });
  it('accepts omitted and positive integer values', () => {
    expect(parseQueryInteger(undefined, 'Trang')).toBeUndefined();
    expect(parseQueryInteger('2', 'Trang')).toBe(2);
  });
});
