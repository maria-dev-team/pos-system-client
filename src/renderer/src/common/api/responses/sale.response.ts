import type { ReturnDisposition } from '../types/sale.types';
import type { ProductUnit } from './product.response';

export type SaleItemResponse = {
  barcode: string;
  base_unit_price: string;
  id: string;
  line_number: number;
  line_total: string;
  name: string;
  price_override_reason: string | null;
  price_overridden_by_membership_id: string | null;
  product_id: string;
  quantity: string;
  return_disposition: ReturnDisposition | null;
  sku: string;
  source_sale_item_id: string | null;
  unit_code: ProductUnit;
  unit_price: string;
};

export type SalePaymentResponse = {
  amount: string;
  change: string | null;
  completed_at: string | null;
  created_at: string;
  direction: 'INCOMING' | 'OUTGOING';
  id: string;
  method: 'CASH' | 'CASHLESS';
  received: string | null;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  updated_at: string;
};

export type HeldSaleResponse = {
  created_at: string;
  held_at: string;
  id: string;
  items_count: number;
  status: 'HELD';
  total: string;
  version: number;
};

export type SaleResponse = {
  cancelled_at: string | null;
  cancelled_by_membership_id: string | null;
  cancellation_reason: string | null;
  cashier_membership_id: string;
  cashier_session_id: string;
  completed_at: string | null;
  created_at: string;
  currency: 'KZT';
  held_at: string | null;
  id: string;
  items: SaleItemResponse[];
  organization_id: string;
  original_sale_id: string | null;
  payments: SalePaymentResponse[];
  receipt_number: string | null;
  register_id: string;
  register_shift_id: string;
  status: 'DRAFT' | 'HELD' | 'COMPLETED' | 'CANCELLED';
  store_id: string;
  total: string;
  transaction_type: 'SALE' | 'RETURN';
  return_reason: string | null;
  updated_at: string;
  version: number;
};

export type PaginationMetaResponse = {
  has_more: boolean;
  limit: number;
  offset: number;
  total: number;
};

export type ReceiptSummaryResponse = {
  cashier_membership_id: string;
  completed_at: string;
  currency: 'KZT';
  id: string;
  payments: Pick<SalePaymentResponse, 'amount' | 'method'>[];
  receipt_number: string;
  total: string;
};

export type ReceiptResponse = Omit<SaleResponse, 'items' | 'receipt_number'> & {
  cashier_name: string | null;
  items: (SaleItemResponse & {
    returnable_quantity: string;
    returned_quantity: string;
  })[];
  receipt_number: string;
};

export type ReceiptsResponse = {
  meta: PaginationMetaResponse;
  receipts: ReceiptSummaryResponse[];
};
