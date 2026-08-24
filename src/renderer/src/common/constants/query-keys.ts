export const queryKeys = {
  auth: {
    context: () => ['auth', 'context'] as const,
    currentUser: () => ['auth', 'user'] as const,
  },
  health: {
    api: () => ['health', 'api'] as const,
  },
  organizations: {
    mine: () => ['organizations', 'mine'] as const,
  },
  registers: {
    active: (storeId?: string | null) =>
      ['registers', 'active', storeId ?? null] as const,
    all: () => ['registers'] as const,
  },
  registerShifts: {
    all: () => ['register-shifts'] as const,
    current: (registerId: string) =>
      ['register-shifts', 'current', registerId] as const,
  },
};
