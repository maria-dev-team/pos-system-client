export type ProductUnit = 'pcs' | 'kg' | 'l' | 'm';

export type ProductResponse = {
  barcode: string;
  /** Absent only in catalogs cached before additional barcode support. */
  additional_barcode?: string | null;
  category_id: string | null;
  created_at: string;
  deleted_at: string | null;
  id: string;
  is_active: boolean;
  is_quick: boolean;
  name: string;
  nkt: {
    gtin: string | null;
    is_deactivated?: boolean;
    is_marked: boolean;
    is_social: boolean;
    name_kk: string | null;
    name_ru: string;
    ntin_code: string;
  } | null;
  nkt_product_id: string | null;
  organization_id: string;
  retail_price: string | null;
  sku: string | null;
  unit: ProductUnit;
  updated_at: string;
  vat_rate: 'NONE' | '0' | '5' | '10' | '16' | null;
};

export type ProductSearchResponse = {
  meta: {
    has_more: boolean;
    limit: number;
    offset: number;
    total: number;
  };
  products: ProductResponse[];
};
