import type { ProductResponse, ReturnDisposition } from '@renderer/common/api';

export type ReceiptSelection = {
  quantity: string;
  returnDisposition: ReturnDisposition | null;
};

export type WithoutReceiptLine = {
  catalogUnitPrice: string;
  id: string;
  markingCode?: string;
  priceOverride?: { reason: string; unitPrice: string };
  product: ProductResponse;
  quantity: string;
  returnDisposition: ReturnDisposition | null;
};
