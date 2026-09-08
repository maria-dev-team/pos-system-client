/** Display-only metadata. Unlocking is based on checkout-state under the server lock. */
export type FiscalErrorDetails = {
  reconciliation_required?: boolean;
  provider_errors?: { code?: unknown; text?: unknown }[];
};

export function fiscalErrorMessage(details: FiscalErrorDetails): string | null {
  if (details.reconciliation_required)
    return 'Результат фискализации требует проверки. Нажмите «Проверить оплату». Не пробивайте этот чек повторно.';
  const reasons = Array.isArray(details.provider_errors)
    ? details.provider_errors
        .slice(0, 3)
        .map((error) =>
          typeof error?.text === 'string' ? error.text.slice(0, 500) : '',
        )
        .filter(Boolean)
    : [];
  return reasons.length ? `ККМ: ${reasons.join('; ')}` : null;
}
