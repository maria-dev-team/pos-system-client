import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProductResponse, SalePaymentPayload } from '@renderer/common/api';

type CartItem = {
  barcode: string;
  catalogUnitPrice: string;
  name: string;
  priceOverride?: { reason: string; unitPrice: string };
  productId: string;
  productUpdatedAt: string;
  quantity: string;
  sku: string;
  unit: ProductResponse['unit'];
};

type PendingOperation =
  | {
      expectedVersion: number;
      payments: SalePaymentPayload[];
      saleId: string;
      type: 'checkout';
    }
  | { expectedVersion: number; saleId: string; type: 'hold' };

type CheckoutCartStore = {
  addProduct: (cashierSessionId: string, product: ProductResponse) => boolean;
  clear: (cashierSessionId: string) => void;
  clearPendingOperation: (cashierSessionId: string) => void;
  deleteSession: (cashierSessionId: string) => void;
  overridePrice: (
    cashierSessionId: string,
    productId: string,
    priceOverride: NonNullable<CartItem['priceOverride']>,
  ) => boolean;
  remove: (cashierSessionId: string, productId: string) => void;
  resetPrice: (cashierSessionId: string, productId: string) => void;
  sessions: Record<
    string,
    { items: CartItem[]; pendingOperation?: PendingOperation }
  >;
  setPendingOperation: (
    cashierSessionId: string,
    pendingOperation: PendingOperation,
  ) => void;
  setQuantity: (
    cashierSessionId: string,
    productId: string,
    quantity: string,
  ) => boolean;
};

type CheckoutApi = {
  adjustCartItemQuantity: (item: CartItem, delta: -1 | 1) => CartItem | null;
  cartItemFromProduct: (product: ProductResponse) => CartItem | null;
  checkoutCartStorageName: string;
  createCashPayment: (
    serverTotal: string,
    received: string,
  ) => SalePaymentPayload[] | null;
  createCashlessPayment: (serverTotal: string) => SalePaymentPayload[] | null;
  createMixedPayments: (
    serverTotal: string,
    cashAmount: string,
    cashReceived: string,
  ) => SalePaymentPayload[] | null;
  findProductByExactBarcode: (
    products: readonly ProductResponse[],
    scannerInput: string,
  ) => ProductResponse | null;
  getCartLineTotal: (item: CartItem) => string;
  getCartTotal: (items: readonly CartItem[]) => string;
  getCashChange: (received: string, cashAmount: string) => string | null;
  useCheckoutCartStore: { getState: () => CheckoutCartStore };
};

const productFixture = (
  overrides: Partial<ProductResponse> = {},
): ProductResponse => ({
  barcode: '001234',
  category_id: null,
  created_at: '2026-08-25T10:00:00.000Z',
  deleted_at: null,
  id: 'product-1',
  is_active: true,
  name: 'Молоко',
  organization_id: 'organization-1',
  retail_price: '12.50',
  sku: 'MILK-1',
  unit: 'kg',
  updated_at: '2026-08-25T10:00:00.000Z',
  ...overrides,
});

const cartItem = (overrides: Partial<CartItem> = {}): CartItem => ({
  barcode: '001234',
  catalogUnitPrice: '12.50',
  name: 'Молоко',
  productId: 'product-1',
  productUpdatedAt: '2026-08-25T10:00:00.000Z',
  quantity: '0.125',
  sku: 'MILK-1',
  unit: 'kg',
  ...overrides,
});

const store = (api: CheckoutApi) => api.useCheckoutCartStore.getState();

const expectApi = <T>(value: T | undefined): value is T => {
  if (value === undefined) {
    expect(value).toBeTypeOf('function');
    return false;
  }
  return true;
};

let localStorageData = new Map<string, string>();

const loadApi = async () => (await import('./index')) as unknown as CheckoutApi;

beforeEach(() => {
  localStorageData = new Map();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => localStorageData.clear(),
      getItem: (key: string) => localStorageData.get(key) ?? null,
      removeItem: (key: string) => localStorageData.delete(key),
      setItem: (key: string, value: string) => localStorageData.set(key, value),
    },
  });
  vi.resetModules();
});

describe('local checkout cart domain', () => {
  it('converts only active, priced products into cart items', async () => {
    const api = await loadApi();
    if (!expectApi(api.cartItemFromProduct)) return;

    expect(api.cartItemFromProduct(productFixture())).toEqual(
      cartItem({ quantity: '1' }),
    );
    expect(
      api.cartItemFromProduct(productFixture({ is_active: false })),
    ).toBeNull();
    expect(
      api.cartItemFromProduct(productFixture({ retail_price: null })),
    ).toBeNull();
  });

  it('selects only an exact trimmed barcode and preserves leading zeroes', async () => {
    const api = await loadApi();
    if (!expectApi(api.findProductByExactBarcode)) return;

    const exact = productFixture();
    expect(
      api.findProductByExactBarcode(
        [
          productFixture({ barcode: '1234', id: 'without-zeroes' }),
          productFixture({ barcode: '0012345', id: 'longer-match' }),
          productFixture({
            barcode: '001234',
            id: 'inactive',
            is_active: false,
          }),
          exact,
        ],
        ' 001234 ',
      ),
    ).toBe(exact);
    expect(api.findProductByExactBarcode([exact], '1234')).toBeNull();
  });

  it('rounds each Decimal line HALF_UP before summing the cart', async () => {
    const api = await loadApi();
    if (
      !expectApi(api.getCartLineTotal) ||
      !expectApi(api.getCartTotal) ||
      !expectApi(api.adjustCartItemQuantity)
    ) {
      return;
    }

    const weighted = cartItem();
    const overridden = cartItem({
      priceOverride: { reason: 'Скидка', unitPrice: '1.00' },
      productId: 'product-2',
      quantity: '0.125',
    });
    expect(api.getCartLineTotal(weighted)).toBe('1.56');
    expect(api.getCartTotal([weighted, overridden])).toBe('1.69');
    const halfCentLines = [
      cartItem({
        catalogUnitPrice: '0.005',
        productId: 'half-cent-1',
        quantity: '1',
      }),
      cartItem({
        catalogUnitPrice: '0.005',
        productId: 'half-cent-2',
        quantity: '1',
      }),
    ];
    expect(api.getCartTotal(halfCentLines)).toBe('0.02');
    expect(api.adjustCartItemQuantity(weighted, 1)?.quantity).toBe('1.125');
    expect(
      api.adjustCartItemQuantity(cartItem({ quantity: '1' }), -1),
    ).toBeNull();
  });

  it('creates only valid exact payment payloads and cash change', async () => {
    const api = await loadApi();
    if (
      !expectApi(api.createCashPayment) ||
      !expectApi(api.createCashlessPayment) ||
      !expectApi(api.createMixedPayments) ||
      !expectApi(api.getCashChange)
    ) {
      return;
    }

    expect(api.createCashPayment('100.00', '120.00')).toEqual([
      { amount: '100.00', method: 'CASH', received: '120.00' },
    ]);
    expect(api.createCashPayment('100.00', '99.99')).toBeNull();
    expect(api.createCashPayment('0.00', '0.00')).toBeNull();
    expect(api.createCashlessPayment('100.00')).toEqual([
      { amount: '100.00', method: 'CASHLESS' },
    ]);
    expect(api.createCashlessPayment('0')).toBeNull();
    expect(api.createMixedPayments('100.00', '40.50', '50.00')).toEqual([
      { amount: '40.50', method: 'CASH', received: '50.00' },
      { amount: '59.50', method: 'CASHLESS' },
    ]);
    expect(api.createMixedPayments('100.00', '0', '50.00')).toBeNull();
    expect(api.createMixedPayments('100.00', '100.00', '100.00')).toBeNull();
    expect(api.createMixedPayments('100.00', '40.00', '39.99')).toBeNull();
    expect(api.getCashChange('50.00', '40.50')).toBe('9.50');
  });
});

describe('persisted checkout carts', () => {
  it('keeps carts isolated and merges repeated products by exactly one', async () => {
    const api = await loadApi();
    if (!expectApi(api.useCheckoutCartStore)) return;

    expect(store(api).addProduct('cashier-a', productFixture())).toBe(true);
    expect(store(api).addProduct('cashier-a', productFixture())).toBe(true);
    expect(
      store(api).addProduct('cashier-b', productFixture({ id: 'product-2' })),
    ).toBe(true);

    expect(store(api).sessions['cashier-a']?.items).toEqual([
      cartItem({ quantity: '2' }),
    ]);
    expect(store(api).sessions['cashier-b']?.items).toEqual([
      cartItem({ productId: 'product-2', quantity: '1' }),
    ]);
  });

  it('limits a cart to 300 distinct products and ignores invalid products', async () => {
    const api = await loadApi();
    if (!expectApi(api.useCheckoutCartStore)) return;

    for (let index = 0; index < 300; index += 1) {
      expect(
        store(api).addProduct(
          'cashier-a',
          productFixture({ id: `product-${index}` }),
        ),
      ).toBe(true);
    }
    expect(
      store(api).addProduct('cashier-a', productFixture({ id: 'product-301' })),
    ).toBe(false);
    expect(
      store(api).addProduct(
        'cashier-a',
        productFixture({ id: 'inactive', is_active: false }),
      ),
    ).toBe(false);
    expect(store(api).sessions['cashier-a']?.items).toHaveLength(300);
  });

  it('validates cart mutations and persists only one session data map', async () => {
    const api = await loadApi();
    if (!expectApi(api.useCheckoutCartStore) || !api.checkoutCartStorageName) {
      expect(api.checkoutCartStorageName).toBeTypeOf('string');
      return;
    }

    store(api).addProduct('cashier-a', productFixture({ unit: 'pcs' }));
    expect(store(api).setQuantity('cashier-a', 'product-1', '1.5')).toBe(false);
    expect(store(api).setQuantity('cashier-a', 'product-1', '3')).toBe(true);
    expect(
      store(api).overridePrice('cashier-a', 'product-1', {
        reason: 'Скидка',
        unitPrice: '10.00',
      }),
    ).toBe(true);
    store(api).setPendingOperation('cashier-a', {
      expectedVersion: 4,
      payments: [{ amount: '30.00', method: 'CASH', received: '30.00' }],
      saleId: 'sale-1',
      type: 'checkout',
    });
    store(api).resetPrice('cashier-a', 'product-1');
    store(api).clearPendingOperation('cashier-a');

    expect(store(api).sessions['cashier-a']).toEqual({
      items: [cartItem({ quantity: '3', unit: 'pcs' })],
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(api.checkoutCartStorageName) ?? '',
      ),
    ).toEqual({ state: { sessions: store(api).sessions }, version: 1 });

    vi.resetModules();
    const rehydrated = await loadApi();
    expect(store(rehydrated).sessions).toEqual(store(api).sessions);
  });

  it('clears, removes and deletes only the requested session', async () => {
    const api = await loadApi();
    if (!expectApi(api.useCheckoutCartStore)) return;

    store(api).addProduct('cashier-a', productFixture());
    store(api).addProduct('cashier-a', productFixture({ id: 'product-2' }));
    store(api).addProduct('cashier-b', productFixture());
    store(api).remove('cashier-a', 'product-1');
    store(api).clear('cashier-a');
    store(api).deleteSession('cashier-a');

    expect(store(api).sessions['cashier-a']).toBeUndefined();
    expect(store(api).sessions['cashier-b']?.items).toEqual([
      cartItem({ quantity: '1' }),
    ]);
  });
});
