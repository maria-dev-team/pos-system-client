import CodepageEncoder from '@point-of-sale/codepage-encoder';

import {
  type PrintableReceipt,
  type ReceiptPaperWidthMm,
  receiptPaperProfiles,
  renderReceiptText,
} from './receipt-document';

const INITIALIZE_AND_SELECT_RK1048 = Buffer.from([
  0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 0x17,
]);
const FEED_THREE_LINES = Buffer.from([0x1b, 0x64, 0x03]);

export const buildEscPosTextReceipt = (
  receipt: PrintableReceipt,
  paperWidthMm: ReceiptPaperWidthMm,
): Buffer => {
  const printWidthDots = receiptPaperProfiles[paperWidthMm].printWidthDots;
  return Buffer.concat([
    INITIALIZE_AND_SELECT_RK1048,
    Buffer.from([
      0x1d,
      0x4c,
      0x00,
      0x00,
      0x1d,
      0x57,
      printWidthDots & 0xff,
      printWidthDots >> 8,
    ]),
    Buffer.from(
      CodepageEncoder.encode(
        renderReceiptText(receipt, paperWidthMm),
        'rk1048',
      ),
    ),
    FEED_THREE_LINES,
  ]);
};
