import { z } from 'zod';

export const cashAmountSchema = z
  .string()
  .trim()
  .min(1, 'Введите сумму наличных')
  .regex(
    /^\d+(?:\.\d{1,2})?$/,
    'Введите сумму с точностью не более двух знаков',
  );
