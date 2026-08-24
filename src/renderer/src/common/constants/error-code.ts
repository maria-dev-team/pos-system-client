export const ErrorCode = {
  CashierSessionMustBeEnded: 'CASHIER_SESSION_MUST_BE_ENDED',
  IncorrectOrganization: 'INCORRECT_ORGANIZATION',
  InsufficientPermissions: 'INSUFFICIENT_PERMISSIONS',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  InvalidSession: 'INVALID_SESSION',
  InvalidToken: 'INVALID_TOKEN',
  OrganizationContextRequired: 'ORGANIZATION_CONTEXT_REQUIRED',
  StoreAccessDenied: 'STORE_ACCESS_DENIED',
  StoreContextRequired: 'STORE_CONTEXT_REQUIRED',
  TooManyRequests: 'TOO_MANY_REQUESTS',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
