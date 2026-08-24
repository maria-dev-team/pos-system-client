export type RegisterResponse = {
  code: string;
  created_at: string;
  id: string;
  name: string;
  organization_id: string;
  status: 'ACTIVE' | 'INACTIVE';
  store_id: string;
  updated_at: string;
};
