// @vitest-environment node
import { expect, it } from 'vitest';

import { ids, profileFixture } from '../../shared/pos/test-fixtures';
import { assertAuthorizedPosSession } from './pos-authorization';

it('accepts a linked active cashier session without system privileges', () => {
  const { context, session, shift } = profileFixture();
  context.isSystemPosition = false;
  expect(() =>
    assertAuthorizedPosSession(context, session, shift, ids.register),
  ).not.toThrow();
});
it.each(['register_id', 'store_id', 'organization_id'] as const)(
  'rejects a shift linked to another %s',
  (field) => {
    const { context, session, shift } = profileFixture();
    shift[field] = ids.product;
    expect(() =>
      assertAuthorizedPosSession(context, session, shift, ids.register),
    ).toThrow(expect.objectContaining({ code: 'CASHIER_SESSION_NOT_ACTIVE' }));
  },
);
it.each(['false', 1, {}, []])(
  'does not grant system privileges from a truthy non-boolean value %s',
  (flag) => {
    const { context, session, shift } = profileFixture();
    const invalid = { ...context, isSystemPosition: flag };
    expect(() =>
      assertAuthorizedPosSession(
        invalid as never,
        session,
        shift,
        ids.register,
      ),
    ).toThrow(expect.objectContaining({ code: 'POS_API_INVALID_RESPONSE' }));
  },
);
it('does not renew a grant from malformed permissions', () => {
  const { context, session, shift } = profileFixture();
  expect(() =>
    assertAuthorizedPosSession(
      { ...context, permissions: [true] } as never,
      session,
      shift,
      ids.register,
    ),
  ).toThrow(expect.objectContaining({ code: 'POS_API_INVALID_RESPONSE' }));
});
