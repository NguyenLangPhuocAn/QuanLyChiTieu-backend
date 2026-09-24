import { normalizeTagName } from './normalize-tag';

describe('Vietnamese tag normalization', () => {
  it('preserves multi-word transport tags and unifies accents and spacing', () => {
    expect(normalizeTagName(' #  DI   CHUYỂN ')).toBe('di chuyển');
    expect(normalizeTagName('di chuyển')).toBe('di chuyển');
  });
  it('does not turn an empty hashtag into whitespace', () => {
    expect(normalizeTagName(' #   ')).toBe('');
  });
});
