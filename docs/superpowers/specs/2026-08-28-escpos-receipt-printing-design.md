# ESC/POS Raster Receipt Printing Design

## Status

Approved in chat on 2026-08-28. The production target is Windows; macOS is required as a development and physical-test platform. The initial printer is Xprinter XP-58IIH.

## Goal

Replace page-based `webContents.print()` receipt output with raw ESC/POS raster output. A receipt must start without an application-added top margin, use the printer's full configured printable width without clipping, end after its real content instead of a fixed page height, and print Kazakh characters such as `Ә Ғ Қ Ң Ө Ұ Ү Һ І` reliably.

## Scope

The existing receipt payload, receipt preview, printer selection, post-sale print button, and history reprint button remain. The change replaces only the physical rendering and transport path plus the width setting needed by that path.

The following remain out of scope:

- fiscalization, OFD, QR codes, returns, and automatic printing;
- cash-drawer and cutter commands;
- direct USB access, Zadig/WinUSB, network-printer discovery, and an application-managed job queue;
- logos, photographs, grayscale image optimization, and vendor-specific printer profiles.

## Decision

The complete receipt is rendered by Chromium from the existing escaped HTML and converted to a one-bit raster. The main process packs that raster into standard ESC/POS `GS v 0` commands and sends the resulting bytes through the operating system's existing printer queue in RAW mode.

This avoids ESC/POS code-page limits because the printer receives pixels rather than encoded text. It also avoids page-size and driver-margin behavior because no page document is created. No npm dependency is added.

Direct USB was rejected because Windows would require replacing the normal printer driver with WinUSB, commonly through Zadig. Text-mode ESC/POS was rejected because XP-58IIH code pages do not cover the required Kazakh alphabet. Keeping `webContents.print()` as a fallback was rejected because it preserves the page-size behavior that this change removes.

## Data Flow

1. The renderer sends the existing validated `PrintableReceipt` and printer settings through the existing preload API.
2. The main process renders the existing CSP-protected receipt HTML in a hidden sandboxed `BrowserWindow` whose CSS width equals the configured print-head width.
3. The document height is measured after loading. Chromium scrolls and captures the document in bands of at most 256 CSS pixels so long receipts do not require one very tall native image.
4. Each band is normalized to the configured pixel dimensions, converted from BGRA to monochrome with a fixed luminance threshold, and packed left-to-right into ESC/POS raster bytes.
5. The encoder emits `ESC @`, one or more `GS v 0` bands, and a small final feed. It emits no leading feed and no fixed page height.
6. Windows submits the bytes through Winspool as datatype `RAW`. macOS pipes the bytes to `/usr/bin/lp` with the `raw` option.
7. The hidden window and any temporary Windows spool file are removed in `finally` paths. Printing never mutates or closes the completed sale.

## Width Configuration

Raw raster printing needs the print head's usable width, not the paper width. The setting therefore changes from `pageWidthMm` to `printWidthDots`.

- default and XP-58IIH preset: `384` dots;
- common 80 mm preset: `576` dots;
- custom value: integer from `128` through `832` dots.

The settings dialog labels the presets as `58 мм — 384 точки` and `80 мм — 576 точек`; the custom field is labeled `Ширина печати, точек`. The existing local-storage key remains, but data with the old `pageWidthMm` shape is treated as invalid and safely falls back to `384` because this feature has not been released yet.

The receipt HTML uses the complete configured width with only a small internal horizontal padding of 8 dots on each side. The physical non-printable paper margins are already represented by the printer's usable dot width and must not be added again in CSS. The preview iframe uses the same HTML and configured pixel width as raster capture.

## Interfaces

The preload surface remains data-only:

```ts
window.receiptPrinter.getPrinters(): Promise<PrinterInfo[]>

window.receiptPrinter.print({
  deviceName: string | null,
  printWidthDots: number,
  receipt: PrintableReceipt
}): Promise<
  | { ok: true }
  | {
      ok: false
      code: 'NO_PRINTER' | 'PRINTER_NOT_FOUND' | 'PRINT_FAILED'
      message: string
    }
>
```

`deviceName: null` means the operating system's default printer. A non-null name is checked against `getPrintersAsync()` before rendering. `PrintableReceipt` is unchanged and HTML or raw ESC/POS bytes never cross renderer IPC.

## Raster Encoding

The target width is rounded up to whole bytes, with unused rightmost bits left white. BGRA pixels are alpha-composited against white and become black when their luminance is below `192`; no dithering is needed for the first version because the document contains only text and CSS rules.

Each ESC/POS `GS v 0` command contains at most 256 raster rows. This keeps job chunks below the XP-58IIH input-buffer limits while preserving arbitrary receipt length. The encoder appends three feed lines for manual tear-off. It does not send a cut command.

## OS Transports

### Windows

The application invokes the built-in Windows PowerShell executable from the Windows system directory without `shell: true`. A constant P/Invoke program calls `OpenPrinter`, `StartDocPrinter` with datatype `RAW`, `StartPagePrinter`, `WritePrinter`, and the matching end/close functions. Printer name and temporary-file path are passed through dedicated environment variables rather than interpolated into PowerShell source.

The ESC/POS buffer is written to a uniquely named file under Electron's temporary directory, submitted completely even if `WritePrinter` performs a partial write, and deleted in `finally`. When `deviceName` is null, Winspool's `GetDefaultPrinter` resolves the queue. A missing default is returned as `PRINTER_NOT_FOUND`.

### macOS

The application spawns `/usr/bin/lp` directly with `shell: false`, adds `-d <deviceName>` only for an explicit queue, adds `-o raw`, and writes the ESC/POS buffer to stdin. With `deviceName: null`, CUPS selects its configured default queue.

Linux is not supported by this version and returns `PRINT_FAILED` without attempting a process spawn.

## Validation, Security, and Errors

- The existing sender identity check and complete `PrintableReceipt` validation remain.
- `printWidthDots` must be an integer between `128` and `832`.
- Process arguments are arrays; user-controlled printer names are never placed in shell source.
- Receipt strings continue to be HTML-escaped and the generated document keeps its restrictive CSP and no external resources.
- A missing explicit printer returns `PRINTER_NOT_FOUND`; an empty printer list returns `NO_PRINTER`; capture, encoding, process, spooler, timeout, and non-zero-exit failures return `PRINT_FAILED` with a cashier-safe message.
- Every path closes the hidden window. Windows additionally removes the temporary file and closes Winspool handles.
- A RAW transport process is terminated after 30 seconds and reported as `PRINT_FAILED`.

## Code Changes

- Keep `receipt-document.ts` as the single HTML source for preview and print; remove page-size calculation and change horizontal padding from millimetres to 8 pixels.
- Add one pure ESC/POS raster encoder module beside the receipt printer code.
- Add one RAW transport module containing the Windows and macOS implementations; no transport interface or factory is introduced for two short platform branches.
- Replace the `webContents.print()` section of the existing IPC handler with Chromium capture, encoding, and RAW submission.
- Change preload, renderer types, local settings, and printer dialog from `pageWidthMm` to `printWidthDots`.
- Remove the Electron 41.2.1 version guard and revert the Electron 43 upgrade, because raw printing no longer depends on the silent custom-page fix.

## Automated Verification

- Document tests keep coverage for item ordering, formatting, escaping, and Kazakh content; the fixed page-size test is removed.
- Raster tests use known small BGRA patterns to verify thresholding, bit order, byte padding, 256-row band boundaries, no leading feed, and the final feed command.
- Transport tests verify direct process spawning, raw flags, explicit/default printer behavior, complete stdin/file handling, non-zero exits, timeouts, and cleanup. The Windows helper itself checks every `WritePrinter` byte count and continues partial writes.
- IPC tests verify sender rejection, invalid widths and payloads, missing printers, dynamic capture height, transport failures, and hidden-window cleanup.
- UI tests verify the 384/576 presets, saved custom width, exact-width preview, test printing, double-click blocking, and error display.
- Project checks are `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.

## Physical Acceptance

On macOS and Windows with the XP-58IIH queue installed, print a short receipt, a 50-plus-item receipt, long product names, mixed payment, and the Kazakh string `Ә Ғ Қ Ң Ө Ұ Ү Һ І`.

Acceptance requires:

- all configured 384 dots fit without right-edge clipping;
- there is no application-generated blank area before the header;
- receipt length follows its content and only the final tear-off feed remains;
- Kazakh glyphs are readable and no replacement symbols appear;
- the preview line wrapping matches the printed raster.

Any small residual top/side gap that remains after this change is a mechanical printer margin, not a page-driver margin.
