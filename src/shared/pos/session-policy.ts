/** Local authorization and the fiscal shift are independent lifecycles. */
export const offlineGrantExpiresAt = (verifiedAt: number): number =>
  verifiedAt + 8 * 60 * 60 * 1000;

export function fiscalShiftExpired(
  openedAt: string,
  now = Date.now(),
): boolean {
  const opened = Date.parse(openedAt);
  return !Number.isFinite(opened) || now - opened >= 24 * 60 * 60 * 1000;
}
