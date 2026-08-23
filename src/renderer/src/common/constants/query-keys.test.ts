import { describe, expect, it } from 'vitest';

import { queryKeys } from './query-keys';

describe('queryKeys', () => {
  it('keeps auth, organization and store-scoped register caches separate', () => {
    expect(queryKeys.auth.context()).toEqual(['auth', 'context']);
    expect(queryKeys.auth.currentUser()).toEqual(['auth', 'user']);
    expect(queryKeys.organizations.mine()).toEqual(['organizations', 'mine']);
    expect(queryKeys.registers.all()).toEqual(['registers']);
    expect(queryKeys.registers.active('store-1')).toEqual([
      'registers',
      'active',
      'store-1',
    ]);
    expect(queryKeys.registers.active()).toEqual(['registers', 'active', null]);
  });
});
