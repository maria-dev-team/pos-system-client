import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ProductResponse, SalePaymentPayload } from '@renderer/common/api';

import { priceOverrideSchema, quantitySchema } from './checkout-input';
import {
  type CartItem,
  adjustCartItemQuantity,
  cartItemFromProduct,
} from './checkout-local-cart';

export type PendingCheckoutOperation = {
  expectedVersion: number;
  payments: SalePaymentPayload[];
  saleId: string;
  type: 'checkout';
};

export type PendingHoldOperation = {
  expectedVersion: number;
  saleId: string;
  type: 'hold';
};

export type PendingOperation = PendingCheckoutOperation | PendingHoldOperation;

export type CheckoutCartSession = {
  items: CartItem[];
  pendingOperation?: PendingOperation;
};

type CheckoutCartStore = {
  addProduct: (cashierSessionId: string, product: ProductResponse) => boolean;
  clear: (cashierSessionId: string) => void;
  clearPendingOperation: (cashierSessionId: string) => void;
  deleteSession: (cashierSessionId: string) => void;
  overridePrice: (
    cashierSessionId: string,
    productId: string,
    priceOverride: CartItem['priceOverride'],
  ) => boolean;
  remove: (cashierSessionId: string, productId: string) => void;
  resetPrice: (cashierSessionId: string, productId: string) => void;
  sessions: Record<string, CheckoutCartSession>;
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

export const checkoutCartStorageName = 'maria-pos-checkout-carts';

const emptySession = (): CheckoutCartSession => ({ items: [] });

const updateSession = (
  sessions: CheckoutCartStore['sessions'],
  cashierSessionId: string,
  update: (session: CheckoutCartSession) => CheckoutCartSession,
) => ({
  ...sessions,
  [cashierSessionId]: update(sessions[cashierSessionId] ?? emptySession()),
});

export const useCheckoutCartStore = create<CheckoutCartStore>()(
  persist(
    (set, get) => ({
      addProduct: (cashierSessionId, product) => {
        const item = cartItemFromProduct(product);
        if (item === null) return false;

        const session = get().sessions[cashierSessionId] ?? emptySession();
        const existing = session.items.find(
          (current) => current.productId === item.productId,
        );
        if (existing) {
          const incremented = adjustCartItemQuantity(existing, 1);
          if (incremented === null) return false;
          set((state) => ({
            sessions: updateSession(
              state.sessions,
              cashierSessionId,
              (current) => ({
                ...current,
                items: current.items.map((currentItem) =>
                  currentItem.productId === item.productId
                    ? incremented
                    : currentItem,
                ),
              }),
            ),
          }));
          return true;
        }
        if (session.items.length >= 300) return false;

        set((state) => ({
          sessions: updateSession(
            state.sessions,
            cashierSessionId,
            (current) => ({
              ...current,
              items: [...current.items, item],
            }),
          ),
        }));
        return true;
      },
      clear: (cashierSessionId) =>
        set((state) => ({
          sessions: updateSession(
            state.sessions,
            cashierSessionId,
            (session) => ({
              ...session,
              items: [],
            }),
          ),
        })),
      clearPendingOperation: (cashierSessionId) =>
        set((state) => ({
          sessions: updateSession(
            state.sessions,
            cashierSessionId,
            (session) => {
              const { pendingOperation, ...withoutPending } = session;
              return pendingOperation ? withoutPending : session;
            },
          ),
        })),
      deleteSession: (cashierSessionId) =>
        set((state) => {
          const sessions = { ...state.sessions };
          delete sessions[cashierSessionId];
          return { sessions };
        }),
      overridePrice: (cashierSessionId, productId, priceOverride) => {
        const parsed = priceOverrideSchema.safeParse(priceOverride);
        if (!parsed.success) return false;

        const session = get().sessions[cashierSessionId];
        if (!session?.items.some((item) => item.productId === productId)) {
          return false;
        }
        set((state) => ({
          sessions: updateSession(
            state.sessions,
            cashierSessionId,
            (current) => ({
              ...current,
              items: current.items.map((item) =>
                item.productId === productId
                  ? { ...item, priceOverride: parsed.data }
                  : item,
              ),
            }),
          ),
        }));
        return true;
      },
      remove: (cashierSessionId, productId) =>
        set((state) => ({
          sessions: updateSession(
            state.sessions,
            cashierSessionId,
            (session) => ({
              ...session,
              items: session.items.filter(
                (item) => item.productId !== productId,
              ),
            }),
          ),
        })),
      resetPrice: (cashierSessionId, productId) =>
        set((state) => ({
          sessions: updateSession(
            state.sessions,
            cashierSessionId,
            (session) => ({
              ...session,
              items: session.items.map((item) => {
                if (item.productId !== productId) return item;
                const { priceOverride, ...withoutOverride } = item;
                return priceOverride ? withoutOverride : item;
              }),
            }),
          ),
        })),
      sessions: {},
      setPendingOperation: (cashierSessionId, pendingOperation) =>
        set((state) => ({
          sessions: updateSession(
            state.sessions,
            cashierSessionId,
            (session) => ({
              ...session,
              pendingOperation,
            }),
          ),
        })),
      setQuantity: (cashierSessionId, productId, quantity) => {
        const session = get().sessions[cashierSessionId];
        const item = session?.items.find(
          (current) => current.productId === productId,
        );
        if (!item) return false;

        const parsed = quantitySchema(item.unit).safeParse(quantity);
        if (!parsed.success) return false;
        set((state) => ({
          sessions: updateSession(
            state.sessions,
            cashierSessionId,
            (current) => ({
              ...current,
              items: current.items.map((currentItem) =>
                currentItem.productId === productId
                  ? { ...currentItem, quantity: parsed.data }
                  : currentItem,
              ),
            }),
          ),
        }));
        return true;
      },
    }),
    {
      name: checkoutCartStorageName,
      partialize: (state) => ({ sessions: state.sessions }),
      storage: createJSONStorage(() => window.localStorage),
      version: 1,
    },
  ),
);
