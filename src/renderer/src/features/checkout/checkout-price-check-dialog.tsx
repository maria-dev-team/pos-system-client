import { LoaderCircle, ScanLine } from 'lucide-react';
import { useRef, useState } from 'react';

import type { ProductResponse } from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { getHttpErrorMessage } from '@renderer/common/helpers/http-error.helper';
import { useProductSearchQuery } from '@renderer/features/products';

import { parseGs1DataMatrix } from '../../../../shared/pos/gs1-data-matrix';
import {
  assertProductSellable,
  productMatchesBarcode,
} from '../../../../shared/pos/product-policy';
import { useCheckoutBarcodeScanner } from './use-checkout-barcode-scanner';

const unitLabels = { kg: 'кг', l: 'л', m: 'м', pcs: 'шт.' } as const;

type Props = {
  canAdd: boolean;
  onAdd: (product: ProductResponse, markingCode?: string) => Promise<unknown>;
  onClose: () => void;
  organizationId: string;
  storeId: string;
};

/** Catalog reads only; a receipt mutation requires the separate, explicit Add button. */
export function CheckoutPriceCheckDialog({
  canAdd,
  onAdd,
  onClose,
  organizationId,
  storeId,
}: Props) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const addingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dataMatrix = parseGs1DataMatrix(search.trim());
  const term = dataMatrix?.gtin ?? search.trim();
  const products = useProductSearchQuery(term, true, organizationId, storeId);
  const wrongOrganization = products.data?.products.some(
    (product) => product.organization_id !== organizationId,
  );
  const results = wrongOrganization ? undefined : products.data;

  const changeSearch = (value: string) => {
    setSearch(value);
    setError(null);
  };
  useCheckoutBarcodeScanner({
    enabled: !adding,
    workspaceRef,
    withinDialog: true,
    onScan: changeSearch,
  });

  const add = async (product: ProductResponse, markingCode?: string) => {
    if (!canAdd || addingRef.current || wrongOrganization) return;
    addingRef.current = true;
    setAdding(product.id);
    setError(null);
    try {
      assertProductSellable(product, markingCode);
      await onAdd(product, markingCode);
      onClose();
    } catch (error) {
      setError(getHttpErrorMessage(error, 'Не удалось добавить товар в чек.'));
    } finally {
      addingRef.current = false;
      setAdding(null);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !addingRef.current) onClose();
      }}
    >
      <DialogContent
        ref={workspaceRef}
        tabIndex={-1}
        className="flex max-h-[calc(100svh-2rem)] flex-col overflow-hidden sm:max-w-2xl"
        showCloseButton={!adding}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          workspaceRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Проверка цены</DialogTitle>
          <DialogDescription>
            Найдите товар или отсканируйте штрихкод. Добавление в чек — по
            отдельной кнопке.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            // Enter from the scanner or keyboard only requests the displayed price.
            workspaceRef.current?.focus();
          }}
        >
          <Label className="sr-only" htmlFor="price-check-search">
            Название или штрихкод для проверки цены
          </Label>
          <div className="relative">
            <ScanLine
              aria-hidden="true"
              className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="price-check-search"
              className="pl-11"
              disabled={Boolean(adding)}
              maxLength={512}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder="Название, основной или дополнительный штрихкод"
              value={search}
            />
          </div>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div
          className="min-h-0 space-y-3 overflow-y-auto"
          aria-live="polite"
          aria-busy={term.length >= 2 && !products.isError && !results}
        >
          {term.length < 2 ? (
            <p className="py-8 text-center text-muted-foreground">
              Сканируйте товар или введите минимум 2 символа названия.
            </p>
          ) : products.isError || wrongOrganization ? (
            <div role="alert" className="space-y-3 py-4">
              <p className="text-sm text-destructive">
                {wrongOrganization
                  ? 'Ответ поиска относится к другой организации.'
                  : getHttpErrorMessage(
                      products.error,
                      'Не удалось получить цену. Проверьте подключение и повторите поиск.',
                    )}
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void products.refetch()}
              >
                Повторить поиск
              </Button>
            </div>
          ) : !results ? (
            <p
              role="status"
              className="flex items-center justify-center gap-2 py-8 text-muted-foreground"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-5 animate-spin"
              />
              Ищем товар…
            </p>
          ) : !results.products.length ? (
            <p className="py-8 text-center text-muted-foreground">
              Товар не найден. Проверьте код или название.
            </p>
          ) : (
            <>
              {results.products.map((product) => {
                const markingCode =
                  dataMatrix && productMatchesBarcode(product, dataMatrix.gtin)
                    ? dataMatrix.markingCode
                    : undefined;
                let unavailable: string | null = null;
                try {
                  assertProductSellable(product, markingCode);
                } catch (error) {
                  unavailable = getHttpErrorMessage(
                    error,
                    'Товар недоступен для продажи.',
                  );
                }
                return (
                  <article
                    key={product.id}
                    className="space-y-3 rounded-xl border border-border bg-muted/20 p-4"
                  >
                    <h2 className="break-words text-lg font-semibold">
                      {product.name}
                    </h2>
                    <p className="break-all text-xs text-muted-foreground">
                      {[
                        product.sku,
                        product.barcode,
                        product.additional_barcode
                          ? `Доп.: ${product.additional_barcode}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Цена по каталогу магазина
                        </p>
                        <p className="text-3xl font-bold tabular-nums text-primary">
                          {product.retail_price === null
                            ? 'Цена не задана'
                            : formatCash(product.retail_price)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          За 1 {unitLabels[product.unit]}
                        </p>
                      </div>
                      {canAdd ? (
                        <Button
                          aria-label={`Добавить в чек ${product.name}`}
                          disabled={Boolean(adding || unavailable)}
                          onClick={() => void add(product, markingCode)}
                          type="button"
                        >
                          {adding === product.id ? (
                            <LoaderCircle
                              aria-hidden="true"
                              className="size-4 animate-spin"
                            />
                          ) : null}
                          Добавить в чек
                        </Button>
                      ) : null}
                    </div>
                    {unavailable ? (
                      <p className="text-sm text-muted-foreground">
                        {unavailable}
                      </p>
                    ) : null}
                  </article>
                );
              })}
              {results.meta.has_more ? (
                <p className="text-sm text-muted-foreground">
                  Уточните название, чтобы найти нужный товар.
                </p>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
