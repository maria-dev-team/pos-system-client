export type RegisterShiftResponse = {
  actual_cash: string | null;
  closed_at: string | null;
  closed_by_membership_id: string | null;
  created_at: string;
  deleted_at: string | null;
  difference: string | null;
  expected_cash: string | null;
  id: string;
  opened_at: string;
  opened_by_membership_id: string;
  opening_cash: string;
  organization_id: string;
  register_id: string;
  status: 'OPEN' | 'CLOSED';
  store_id: string;
  updated_at: string;
};
