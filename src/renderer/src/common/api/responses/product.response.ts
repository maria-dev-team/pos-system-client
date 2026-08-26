export type ProductUnit = 'pcs' | 'kg' | 'l' | 'm';

export type ProductResponse = {
  barcode: string;
  category_id: string | null;
  created_at: string;
  deleted_at: string | null;
  id: string;
  is_active: boolean;
  name: string;
  organization_id: string;
  retail_price: string | null;
  sku: string;
  unit: ProductUnit;
  updated_at: string;
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
