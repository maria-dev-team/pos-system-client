export type Gs1DataMatrix = {
  gtin: string;
  markingCode: string;
};

const stripScannerEnvelope = (value: string): string =>
  value.replace(/^\](?:d2|Q3)/u, '').replace(/[\r\n]+$/gu, '');

export const parseGs1DataMatrix = (value: string): Gs1DataMatrix | null => {
  const markingCode = stripScannerEnvelope(value);
  const parenthesized = /^\(01\)(\d{14})(?=.+)/u.exec(markingCode);
  if (parenthesized) {
    return { gtin: parenthesized[1]!, markingCode };
  }

  const compact = /^01(\d{14})(?=.+)/u.exec(markingCode);
  if (compact) return { gtin: compact[1]!, markingCode };

  return null;
};
