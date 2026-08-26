const integerFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 0,
});

export const formatCash = (value: string | null): string => {
  if (value === null) return '—';
  const [integer = '0', fraction = ''] = value.split('.');
  return `${integerFormatter
    .format(BigInt(integer))
    .replaceAll('\u00a0', ' ')},${fraction.padEnd(2, '0')} ₸`;
};
