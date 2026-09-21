export type CategoryResponse = {
  children: CategoryResponse[];
  created_at: string;
  deleted_at: string | null;
  id: string;
  name: string;
  organization_id: string;
  parent_id: string | null;
  updated_at: string;
};

export type CategorySearchResponse = {
  categories: CategoryResponse[];
  meta: {
    has_more: boolean;
    limit: number;
    offset: number;
    total: number;
  };
};
