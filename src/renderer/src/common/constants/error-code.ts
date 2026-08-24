export const ErrorCode = {
  CashierSessionMustBeEnded: 'CASHIER_SESSION_MUST_BE_ENDED',
  IncorrectOrganization: 'INCORRECT_ORGANIZATION',
  InsufficientPermissions: 'INSUFFICIENT_PERMISSIONS',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  InvalidCashAmount: 'INVALID_CASH_AMOUNT',
  InvalidSession: 'INVALID_SESSION',
  InvalidToken: 'INVALID_TOKEN',
  OrganizationContextRequired: 'ORGANIZATION_CONTEXT_REQUIRED',
  RegisterNotActive: 'REGISTER_NOT_ACTIVE',
  RegisterNotFound: 'REGISTER_NOT_FOUND',
  RegisterShiftAlreadyClosed: 'REGISTER_SHIFT_ALREADY_CLOSED',
  RegisterShiftAlreadyOpen: 'REGISTER_SHIFT_ALREADY_OPEN',
  RegisterShiftCloseForbidden: 'REGISTER_SHIFT_CLOSE_FORBIDDEN',
  RegisterShiftHasCurrentCashierSession:
    'REGISTER_SHIFT_HAS_CURRENT_CASHIER_SESSION',
  RegisterShiftNotFound: 'REGISTER_SHIFT_NOT_FOUND',
  StoreAccessDenied: 'STORE_ACCESS_DENIED',
  StoreContextRequired: 'STORE_CONTEXT_REQUIRED',
  TooManyRequests: 'TOO_MANY_REQUESTS',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
