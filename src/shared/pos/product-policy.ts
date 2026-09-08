import { PosError, type ProductResponse } from './contracts';

/** The same product rules apply to SQLite commands and the browser fallback. */
export function assertProductSellable(
  product: ProductResponse | undefined,
  markingCode?: string,
): asserts product is ProductResponse & {
  nkt: NonNullable<ProductResponse['nkt']>;
  retail_price: string;
} {
  if (!product || !product.is_active || product.deleted_at)
    throw new PosError('PRODUCT_NOT_FOUND', 'Товар не найден или неактивен.');
  if (product.retail_price === null)
    throw new PosError(
      'PRODUCT_SALE_PRICE_REQUIRED',
      'У товара не указана цена.',
    );
  if (!product.nkt?.ntin_code || product.nkt.is_deactivated)
    throw new PosError(
      'PRODUCT_NKT_REQUIRED',
      'Товар не сопоставлен с НКТ. Откройте его в каталоге DukenAI.',
    );
  if (product.nkt.is_marked && !markingCode)
    throw new PosError(
      'PRODUCT_MARKING_CODE_REQUIRED',
      'Товар маркирован. Отсканируйте Data Matrix с упаковки.',
    );
  if (!product.nkt.is_marked && markingCode)
    throw new PosError(
      'PRODUCT_MARKING_CODE_NOT_ALLOWED',
      'Товар не отмечен как маркированный.',
    );
}

export function selectExactBarcodeProduct(
  products: ProductResponse[],
  barcode: string,
): ProductResponse {
  const matches = products.filter(
    (product) => product.barcode === barcode || product.nkt?.gtin === barcode,
  );
  if (matches.length > 1)
    throw new PosError(
      'PRODUCT_BARCODE_AMBIGUOUS',
      'Код соответствует нескольким товарам. Выберите товар по названию.',
    );
  if (!matches.length)
    throw new PosError(
      'PRODUCT_NOT_FOUND',
      `Товар с кодом ${barcode} не найден`,
    );
  return matches[0]!;
}
