import { z } from 'zod';

export const cashMovementSchema = z.object({
  type: z.enum(['DEPOSIT', 'WITHDRAWAL']),
  amount: z
    .string()
    .trim()
    .transform((value) => value.replace(',', '.'))
    .pipe(
      z
        .string()
        .regex(
          /^\d{1,16}(?:\.\d{1,2})?$/,
          'Введите сумму с точностью до двух знаков',
        )
        .refine(
          (value) => /[1-9]/.test(value),
          'Сумма должна быть больше нуля',
        ),
    )
    .transform((value) => {
      const [whole, fraction = ''] = value.split('.');
      return `${BigInt(whole!)}.${fraction.padEnd(2, '0')}`;
    }),
  reason: z
    .string()
    .trim()
    .min(3, 'Укажите причину, минимум 3 символа')
    .max(500, 'Не более 500 символов'),
});
export const pendingCashMovementSchema = cashMovementSchema.extend({
  operationId: z.string().uuid(),
});
