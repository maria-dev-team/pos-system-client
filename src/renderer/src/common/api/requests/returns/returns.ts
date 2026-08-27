import { request } from '../../request';
import type {
  ReceiptResponse,
  ReceiptsResponse,
  SaleResponse,
} from '../../responses/sale.response';
import type {
  CreateReceiptReturnPayload,
  CreateWithoutReceiptReturnPayload,
  ReceiptsQueryPayload,
} from '../../types/sale.types';

export const getReceipts = async (
  params: ReceiptsQueryPayload,
): Promise<ReceiptsResponse> => {
  const response = await request.get('/v1/sales/receipts', { params });
  return response.data.data as ReceiptsResponse;
};

export const getReceipt = async (
  receiptNumber: string,
): Promise<ReceiptResponse> => {
  const response = await request.get(`/v1/sales/receipts/${receiptNumber}`);
  return response.data.data.receipt as ReceiptResponse;
};

const idempotencyHeaders = (idempotencyKey: string) => ({
  'Idempotency-Key': idempotencyKey,
});

export const createReceiptReturn = async (
  receiptNumber: string,
  idempotencyKey: string,
  payload: CreateReceiptReturnPayload,
): Promise<SaleResponse> => {
  const response = await request.post(
    `/v1/returns/receipts/${receiptNumber}`,
    payload,
    { headers: idempotencyHeaders(idempotencyKey) },
  );
  return response.data.data.return as SaleResponse;
};

export const createWithoutReceiptReturn = async (
  idempotencyKey: string,
  payload: CreateWithoutReceiptReturnPayload,
): Promise<SaleResponse> => {
  const response = await request.post('/v1/returns/without-receipt', payload, {
    headers: idempotencyHeaders(idempotencyKey),
  });
  return response.data.data.return as SaleResponse;
};
