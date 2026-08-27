import { z } from 'zod';

import type { ProductUnit } from '../api/responses/product.response';

const quantityPattern = /^\d{1,6}(?:\.\d{1,3})?$/;
const unitLabels: Record<ProductUnit, string> = {
  kg: 'кг',
  l: 'л',
  m: 'м',
  pcs: 'шт.',
};
const thousandths = 1000n;

export function quantitySchema(unit: ProductUnit) {
  return z
    .string()
    .trim()
    .regex(quantityPattern, 'Введите количество с точностью до трех знаков')
    .refine(
      (quantity) => /[1-9]/.test(quantity),
      'Количество должно быть больше нуля',
    )
    .refine(
      (quantity) => unit !== 'pcs' || !quantity.includes('.'),
      'Количество в штуках должно быть целым',
    );
}

export function formatQuantity(quantity: string, unit: ProductUnit) {
  const [integer, decimal = ''] = quantity.trim().split('.');
  const fraction = decimal.replace(/0+$/, '');
  const value = fraction ? `${integer},${fraction}` : integer;

  return `${value} ${unitLabels[unit]}`;
}

export function adjustQuantityByOne(quantity: string, delta: -1 | 1) {
  const [integer = '0', decimal = ''] = quantity.trim().split('.');
  const amount = BigInt(integer) * thousandths + BigInt(decimal.padEnd(3, '0'));
  const next = amount + BigInt(delta) * thousandths;

  if (next <= 0n) return null;

  const whole = next / thousandths;
  const fraction = String(next % thousandths)
    .padStart(3, '0')
    .replace(/0+$/, '');

  return fraction ? `${whole}.${fraction}` : String(whole);
}
