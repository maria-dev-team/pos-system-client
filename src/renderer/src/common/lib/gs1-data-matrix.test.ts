import { describe, expect, it } from 'vitest';

import { parseGs1DataMatrix } from './gs1-data-matrix';

describe('parseGs1DataMatrix', () => {
  it.each([
    [
      ']d2010487000000001221SERIAL\u001d91ABC',
      '010487000000001221SERIAL\u001d91ABC',
    ],
    ['010487000000001221SERIAL', '010487000000001221SERIAL'],
    ['(01)04870000000012(21)SERIAL', '(01)04870000000012(21)SERIAL'],
  ])(
    'extracts GTIN and preserves the marking payload from %s',
    (raw, expected) => {
      expect(parseGs1DataMatrix(raw)).toEqual({
        gtin: '04870000000012',
        markingCode: expected,
      });
    },
  );

  it.each(['4870000000012', '0104870000000012', '', 'milk'])(
    'does not treat a regular value as Data Matrix: %s',
    (value) => expect(parseGs1DataMatrix(value)).toBeNull(),
  );
});
