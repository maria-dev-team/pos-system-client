export type CashierSessionResponse = {
  actual_cash: string | null;
  created_at: string;
  difference: string | null;
  end_reason:
    'LOGOUT' | 'CASHIER_SWITCH' | 'SHIFT_CLOSED' | 'ADMIN_TERMINATED' | null;
  ended_at: string | null;
  expected_cash: string | null;
  id: string;
  locked_at: string | null;
  membership_id: string;
  opening_cash: string;
  organization_id: string;
  register_id: string;
  register_shift_id: string;
  started_at: string;
  status: 'ACTIVE' | 'LOCKED' | 'ENDED';
  store_id: string;
  updated_at: string;
};
