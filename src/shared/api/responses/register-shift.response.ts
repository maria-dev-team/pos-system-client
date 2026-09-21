export type RegisterShiftResponse = {
  actual_cash: string | null;
  closed_at: string | null;
  closed_by_membership_id: string | null;
  created_at: string;
  deleted_at: string | null;
  difference: string | null;
  expected_cash: string | null;
  fiscal_closed_at: string | null;
  fiscal_shift_number: string | null;
  id: string;
  opened_at: string;
  opened_by_membership_id: string;
  opening_cash: string;
  organization_id: string;
  register_id: string;
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
  store_id: string;
  updated_at: string;
};

type FiscalShiftOperationResponse = {
  amount: string;
  count: number;
};

export type FiscalShiftReportResponse = {
  cash: { balance: string; deposited: string; withdrawn: string };
  cashbox: {
    identity_number: string;
    registration_number: string;
    serial_number: string;
  };
  cashier: { code: string | null; name: string | null };
  change: string;
  closed_at: string | null;
  control_sum: string;
  discount: string;
  document_count: number;
  generated_at: string;
  markup: string;
  ofd: { name: string; website: string | null };
  offline: boolean;
  opened_at: string;
  operations: {
    purchase_returns: FiscalShiftOperationResponse;
    purchases: FiscalShiftOperationResponse;
    sale_returns: FiscalShiftOperationResponse;
    sales: FiscalShiftOperationResponse;
  };
  payments: { amount: string; provider_type: number }[];
  provider: 'WEBKASSA';
  report_number: string;
  report_type: 'X' | 'Z';
  shift_number: string;
  taken: string;
  taxpayer: { bin_iin: string | null; name: string | null };
  vat: string;
};

export type CloseRegisterShiftResponse = {
  register_shift: RegisterShiftResponse;
  z_report: FiscalShiftReportResponse | null;
};
