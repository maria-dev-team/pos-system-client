import axios from 'axios';

import { scanAmbiguitySchema } from '../../../../shared/pos/barcode-scan';
import { PosError } from '../../../../shared/pos/contracts';

export function getScanAmbiguity(error: unknown) {
  const code =
    error instanceof PosError
      ? error.code
      : axios.isAxiosError(error)
        ? error.response?.data?.error_code
        : undefined;
  if (code !== 'PRODUCT_BARCODE_AMBIGUOUS') return null;
  const value =
    error instanceof PosError
      ? error.details
      : axios.isAxiosError(error) && error.response?.status === 409
        ? error.response.data
        : undefined;
  const parsed = scanAmbiguitySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
