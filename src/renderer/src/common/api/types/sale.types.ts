export type CreateSaleItemPayload = {
  productId: string;
  quantity: string;
  priceOverride?: {
    reason: string;
    unitPrice: string;
  };
};

export type CreateSalePayload = {
  items: CreateSaleItemPayload[];
};

export type ScanSaleItemPayload = {
  barcode: string;
  expectedVersion: number;
  quantityDelta: string;
};

export type AddSaleItemPayload = {
  expectedVersion: number;
  productId: string;
  quantity: string;
};

export type SetSaleItemQuantityPayload = {
  expectedVersion: number;
  quantity: string;
};

export type SaleVersionPayload = {
  expectedVersion: number;
};

export type OverrideSaleItemPricePayload = SaleVersionPayload & {
  reason: string;
  unitPrice: string;
};

export type CancelSalePayload = SaleVersionPayload & {
  reason?: string;
};

export type PaymentMethod = 'CASH' | 'CASHLESS';

export type SalePaymentPayload = {
  amount: string;
  method: PaymentMethod;
  received?: string;
};

export type CheckoutSalePayload = SaleVersionPayload & {
  payments: SalePaymentPayload[];
};

export type ReturnDisposition = 'RESTOCK' | 'WRITE_OFF';

export type ReturnPaymentPayload = {
  amount: string;
  method: PaymentMethod;
};

export type CreateReceiptReturnPayload = {
  items: {
    quantity: string;
    returnDisposition: ReturnDisposition;
    saleItemId: string;
  }[];
  payments: ReturnPaymentPayload[];
  reason: string;
};

export type CreateWithoutReceiptReturnPayload = {
  items: {
    priceOverride?: { reason: string; unitPrice: string };
    productId: string;
    quantity: string;
    returnDisposition: ReturnDisposition;
  }[];
  payments: ReturnPaymentPayload[];
  reason: string;
};

export type ReceiptsQueryPayload = {
  limit: number;
  offset: number;
};
