import { request } from '../../request';
import type {
  HeldSaleResponse,
  SaleResponse,
} from '../../responses/sale.response';
import type {
  AddSaleItemPayload,
  CancelSalePayload,
  CheckoutSalePayload,
  CreateSalePayload,
  OverrideSaleItemPricePayload,
  SaleVersionPayload,
  ScanSaleItemPayload,
  SetSaleItemQuantityPayload,
} from '../../types/sale.types';

const unwrapSale = (response: { data: { data: { sale: SaleResponse } } }) =>
  response.data.data.sale;

export async function createSale(
  payload: CreateSalePayload,
): Promise<SaleResponse> {
  return unwrapSale(await request.post('/v1/sales', payload));
}

export const getCurrentSale = async (): Promise<SaleResponse | null> =>
  unwrapSale(await request.get('/v1/sales/current'));

export const getHeldSales = async (): Promise<HeldSaleResponse[]> => {
  const response = await request.get('/v1/sales/held');
  return response.data.data.sales as HeldSaleResponse[];
};

export const getSale = async (saleId: string): Promise<SaleResponse> =>
  unwrapSale(await request.get(`/v1/sales/${saleId}`));

export const scanSaleItem = async (
  saleId: string,
  payload: ScanSaleItemPayload,
): Promise<SaleResponse> =>
  unwrapSale(await request.post(`/v1/sales/${saleId}/items/scan`, payload));

export const addSaleItem = async (
  saleId: string,
  payload: AddSaleItemPayload,
): Promise<SaleResponse> =>
  unwrapSale(await request.post(`/v1/sales/${saleId}/items`, payload));

export const setSaleItemQuantity = async (
  saleId: string,
  itemId: string,
  payload: SetSaleItemQuantityPayload,
): Promise<SaleResponse> =>
  unwrapSale(
    await request.post(
      `/v1/sales/${saleId}/items/${itemId}/set-quantity`,
      payload,
    ),
  );

export const removeSaleItem = async (
  saleId: string,
  itemId: string,
  payload: SaleVersionPayload,
): Promise<SaleResponse> =>
  unwrapSale(
    await request.post(`/v1/sales/${saleId}/items/${itemId}/remove`, payload),
  );

export const overrideSaleItemPrice = async (
  saleId: string,
  itemId: string,
  payload: OverrideSaleItemPricePayload,
): Promise<SaleResponse> =>
  unwrapSale(
    await request.post(
      `/v1/sales/${saleId}/items/${itemId}/override-price`,
      payload,
    ),
  );

export const resetSaleItemPrice = async (
  saleId: string,
  itemId: string,
  payload: SaleVersionPayload,
): Promise<SaleResponse> =>
  unwrapSale(
    await request.post(
      `/v1/sales/${saleId}/items/${itemId}/reset-price`,
      payload,
    ),
  );

export const cancelSale = async (
  saleId: string,
  payload: CancelSalePayload,
): Promise<SaleResponse> =>
  unwrapSale(await request.post(`/v1/sales/${saleId}/cancel`, payload));

export const holdSale = async (
  saleId: string,
  payload: SaleVersionPayload,
): Promise<SaleResponse> =>
  unwrapSale(await request.post(`/v1/sales/${saleId}/hold`, payload));

export const resumeSale = async (
  saleId: string,
  payload: SaleVersionPayload,
): Promise<SaleResponse> =>
  unwrapSale(await request.post(`/v1/sales/${saleId}/resume`, payload));

export const checkoutSale = async (
  saleId: string,
  payload: CheckoutSalePayload,
): Promise<SaleResponse> =>
  unwrapSale(await request.post(`/v1/sales/${saleId}/checkout`, payload));
