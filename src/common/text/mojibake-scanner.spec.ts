import { findMojibakeReason } from './mojibake-scanner';

describe('findMojibakeReason', () => {
  it('detects UTF-8 text decoded with the wrong encoding', () => {
    expect(findMojibakeReason('NgÃ¢n sÃ¡ch')).toBe('encoding-sequence');
  });

  it('detects Vietnamese letters replaced by question marks', () => {
    expect(findMojibakeReason('Ng??i d?ng')).toBe('replacement-question-mark');
  });

  it('does not flag a legitimate Vietnamese question', () => {
    expect(findMojibakeReason('Bạn đã chi bao nhiêu?')).toBeNull();
  });

  it('detects the Unicode replacement character', () => {
    expect(findMojibakeReason(`Ngân s${String.fromCodePoint(0xfffd)}ch`)).toBe(
      'unicode-replacement',
    );
  });
});
