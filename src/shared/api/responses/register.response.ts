export type FiscalizationPolicy = 'ALWAYS' | 'SELECTIVE' | 'CASHLESS_ONLY';

export type RegisterResponse = {
  code: string;
  created_at: string;
  fiscalization: {
    cashbox_unique_number: string | null;
    enabled: boolean;
    policy: FiscalizationPolicy;
    provider: 'REKASSA' | 'WEBKASSA' | null;
  };
  id: string;
  name: string;
  organization_id: string;
  status: 'ACTIVE' | 'INACTIVE';
  store_id: string;
  updated_at: string;
};
