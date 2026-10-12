import { z } from 'zod';

import type { ProductResponse } from '../api/responses/product.response';
import { PosError } from './contracts';

export const scaleProfileSchema = z
  .object({
    format: z.literal('ean13-weight-v1'),
    prefix: z
      .string()
      .regex(/^\d{2}$/)
      .refine((value) => value !== '29')
      .nullable(),
    enabled: z.boolean(),
    blocked_reason: z.literal('barcode_conflict').nullable(),
  })
  .refine((profile) => !profile.enabled || profile.prefix !== null);

export type ScaleProfile = z.infer<typeof scaleProfileSchema>;
export type WeightedBarcode = { scalePlu: number; quantity: string };

export function parseWeightedBarcode(
  code: string,
  profile: ScaleProfile | null | undefined,
): WeightedBarcode | null {
  if (
    !profile?.prefix ||
    !/^\d{13}$/.test(code) ||
    !code.startsWith(profile.prefix)
  )
    return null;
  const sum = [...code.slice(0, 12)].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1),
    0,
  );
  const scalePlu = Number(code.slice(2, 7));
  const grams = code.slice(7, 12);
  if (
    (10 - (sum % 10)) % 10 !== Number(code[12]) ||
    scalePlu === 0 ||
    grams === '00000'
  )
    throw new PosError(
      'SCALE_BARCODE_INVALID',
      'Некорректная весовая этикетка. Проверьте штрихкод.',
    );
  if (profile.blocked_reason)
    throw new PosError(
      'SCALE_BARCODE_CONFLICT',
      'Префикс весов совпадает с кодом товара. Исправьте конфликт в каталоге.',
    );
  // Split the encoded grams directly to avoid floating-point weight arithmetic.
  const integer = grams.slice(0, 2).replace(/^0+(?=\d)/, '');
  const fraction = grams.slice(2).replace(/0+$/, '');
  return { scalePlu, quantity: fraction ? `${integer}.${fraction}` : integer };
}

export function assertWeightedProduct(
  product: ProductResponse | undefined,
  label: WeightedBarcode,
): asserts product is ProductResponse {
  if (!product)
    throw new PosError(
      'PRODUCT_NOT_FOUND',
      'Товар с PLU этикетки не найден в каталоге магазина.',
    );
  if (product.unit !== 'kg' || product.scale_plu !== label.scalePlu)
    throw new PosError(
      'SCALE_BARCODE_INVALID',
      'Этикетка не соответствует весовому товару.',
    );
}
