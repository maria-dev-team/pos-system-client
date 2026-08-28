# ESC/POS Text Receipt Printing Design

## Status

Superseded by the text-printing decision approved in chat on 2026-08-29. The production target is Windows, macOS is the development test platform, and the first printer is Xprinter XP-58IIH.

## Decision

Receipts are formatted as fixed-column text and sent as raw ESC/POS bytes through the existing operating-system queue. Chromium capture, raster bands, page sizes, direct USB, cutter commands, and an application print queue are not used.

The public setting is the installed paper width:

- `58 mm` maps internally to a 384-dot print area and 32 text columns;
- `80 mm` maps internally to a 576-dot print area and 48 text columns.

The cashier never enters or sees dot values. Old internal 384/576-dot local-storage presets migrate to 58/80 mm.

## ESC/POS Output

The encoder emits:

1. `ESC @` to initialize;
2. `FS .` to leave Chinese character mode;
3. `ESC t 23` to select the Xprinter international page;
4. `GS L 0` and `GS W` with the internal 384/576-dot width;
5. receipt text encoded as RK1048;
6. `ESC d 3` for manual tear-off.

There is no leading feed or fixed receipt height. Names and values wrap at 32 or 48 Unicode characters, items retain line-number order, and money uses the ASCII suffix `KZT` because the tenge sign is not available in the selected single-byte page.

The zero-dependency `@point-of-sale/codepage-encoder` package supplies the RK1048 mapping instead of a locally maintained character table.

## Kazakh Firmware Trial

The XP-58IIH specification lists PC866 and PT151/Windows-1251 but does not list RK1048. The application deliberately sends the RK1048 bytes for `Ә Ғ Қ Ң Ө Ұ Ү Һ І` on Xprinter page 23 so the physical test reveals whether the installed firmware maps that page to a Kazakh font.

If those glyphs print incorrectly, install the Kazakh font/code-page firmware with the Xprinter utility and repeat the same test. If that utility assigns Kazakhstan to a page other than 23, only the page byte in `escpos-text.ts` needs to change.

## Interfaces

```ts
window.receiptPrinter.print({
  deviceName: string | null,
  paperWidthMm: 58 | 80,
  receipt: PrintableReceipt
})
```

The existing sender check, complete receipt validation, printer existence check, cashier-safe errors, Winspool RAW transport, and macOS `lp -o raw` transport remain.

## Verification

- Formatter tests verify item order, 32/48-column wrapping, payments, and money formatting.
- Encoder tests verify RK1048 bytes, page selection, 384/576-dot print areas, no raster command, and final feed.
- IPC tests verify the millimetre-only contract, sparse-array rejection, printer errors, and direct text submission.
- UI tests verify the 58/80 mm selector, migration, preview, manual print, and repeat print.
- Physical acceptance on XP-58IIH checks `Ә Ғ Қ Ң Ө Ұ Ү Һ І`, long names, mixed payment, no top margin, no right clipping, and content-dependent length.
