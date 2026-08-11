export type MojibakeReason =
  | 'encoding-sequence'
  | 'replacement-question-mark'
  | 'unicode-replacement';

const encodingSequences = [
  [0x00c3, 0x00a0],
  [0x00c3, 0x00a1],
  [0x00c3, 0x00a2],
  [0x00c3, 0x00aa],
  [0x00c3, 0x00b4],
  [0x00c4, 0x0091],
  [0x00c6, 0x00b0],
  [0x00e1, 0x00ba],
  [0x00e1, 0x00bb],
  [0x00e2, 0x0082],
].map((codePoints) => String.fromCodePoint(...codePoints));

const damagedQuestionMark =
  /(?:[A-Za-z\u00c0-\u1ef9]\?+[A-Za-z\u00c0-\u1ef9])|(?:\?{2,})|(?:^\?[A-Za-z\u00c0-\u1ef9])/;

export const findMojibakeReason = (
  value: string | null | undefined,
): MojibakeReason | null => {
  if (!value) {
    return null;
  }

  if (value.includes(String.fromCodePoint(0xfffd))) {
    return 'unicode-replacement';
  }

  if (encodingSequences.some((sequence) => value.includes(sequence))) {
    return 'encoding-sequence';
  }

  return damagedQuestionMark.test(value) ? 'replacement-question-mark' : null;
};
