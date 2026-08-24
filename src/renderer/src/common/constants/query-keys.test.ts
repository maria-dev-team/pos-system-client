import { describe, expect, it } from 'vitest';

import { queryKeys } from './query-keys';

describe('queryKeys', () => {
  it('keeps auth, organization and store-scoped register caches separate', () => {
    expect(queryKeys.auth.context()).toEqual(['auth', 'context']);
    expect(queryKeys.auth.currentUser()).toEqual(['auth', 'user']);
    expect(queryKeys.health.api()).toEqual(['health', 'api']);
    expect(queryKeys.organizations.mine()).toEqual(['organizations', 'mine']);
    expect(queryKeys.registers.all()).toEqual(['registers']);
    expect(queryKeys.registers.active('store-1')).toEqual([
      'registers',
      'active',
      'store-1',
    ]);
    expect(queryKeys.registers.active()).toEqual(['registers', 'active', null]);
    expect(queryKeys.registerShifts.all()).toEqual(['register-shifts']);
    expect(queryKeys.registerShifts.current('register-1')).toEqual([
      'register-shifts',
      'current',
      'register-1',
    ]);
  });
});
