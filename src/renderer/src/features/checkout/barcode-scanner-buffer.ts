const MAX_LENGTH = 512;
const MIN_LENGTH = 4;
const MAX_KEY_GAP_MS = 80;
const MAX_MEAN_KEY_GAP_MS = 40;
const IDLE_RESET_MS = 500;

/** Keyboard-wedge framing only; no DOM, product lookups or sale mutations. */
export class BarcodeScannerBuffer {
  private value = '';
  private startedAt = 0;
  private lastAt: number | null = null;
  private invalid = false;

  reset(): void {
    this.value = '';
    this.lastAt = null;
    this.invalid = false;
  }

  interrupt(): void {
    if (this.lastAt !== null) this.invalid = true;
  }

  get isCandidate(): boolean {
    return !this.invalid && this.value.length >= MIN_LENGTH;
  }

  accept(key: string, at: number): string | null {
    if (!Number.isFinite(at)) {
      this.reset();
      return null;
    }
    if (
      this.lastAt !== null &&
      (at < this.lastAt || at - this.lastAt > IDLE_RESET_MS)
    )
      this.reset();
    if (key === 'Enter' || key === 'Tab') {
      const barcode = this.value.trim();
      const matched =
        this.isCandidate &&
        barcode.length >= MIN_LENGTH &&
        this.lastAt !== null &&
        at - this.lastAt <= MAX_KEY_GAP_MS &&
        (at - this.startedAt) / this.value.length <= MAX_MEAN_KEY_GAP_MS;
      this.reset();
      return matched ? barcode : null;
    }
    // Shift is part of uppercase/punctuation input. Ctrl+] is mapped to GS
    // by the DOM adapter; pressing a modifier alone does not add a character.
    if (key === 'Shift' || key === 'Control') return null;
    const code = key.charCodeAt(0);
    if (key.length !== 1 || (code < 32 && code !== 29) || code === 127) {
      this.interrupt();
      return null;
    }
    if (this.lastAt === null) this.startedAt = at;
    else if (at - this.lastAt > MAX_KEY_GAP_MS) this.invalid = true;
    this.lastAt = at;
    // Discard the entire overlong/slow frame, never scan a truncated suffix.
    if (this.value.length >= MAX_LENGTH) this.invalid = true;
    else this.value += key;
    return null;
  }
}
