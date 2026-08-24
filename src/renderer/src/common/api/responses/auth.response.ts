import type { OrganizationMembershipResponse } from './organization.response';
import type { UserResponse } from './user.response';

export type AuthResponse = {
  access_token: string;
};

export type LoginResponse = {
  auth: AuthResponse;
  organizations: OrganizationMembershipResponse[];
  user: UserResponse;
};
