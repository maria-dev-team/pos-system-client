import { z } from 'zod';

import { PosError, type PosProfile } from '../../shared/pos/contracts';

const id = z.uuid();
const contextSchema = z.object({
  organizationId: id,
  userOrganizationId: id,
  storeId: id,
  isSystemPosition: z.boolean().optional(),
  permissions: z.array(z.string()).max(1000),
});
const sessionSchema = z.object({
  id,
  organization_id: id,
  store_id: id,
  register_id: id,
  register_shift_id: id,
  membership_id: id,
  status: z.string(),
});
const shiftSchema = z.object({
  id,
  organization_id: id,
  store_id: id,
  register_id: id,
  status: z.string(),
  opened_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
});

/** Shared by initial login and background renewal. Never coerce privilege flags. */
export function assertAuthorizedPosSession(
  context: PosProfile['context'],
  session: PosProfile['session'] | null,
  shift: PosProfile['shift'] | null,
  registerId: string,
): void {
  if (!session || !shift)
    throw new PosError(
      'CASHIER_SESSION_NOT_ACTIVE',
      'Смена кассира недоступна.',
    );
  if (
    !contextSchema.safeParse(context).success ||
    !sessionSchema.safeParse(session).success ||
    !shiftSchema.safeParse(shift).success
  )
    throw new PosError(
      'POS_API_INVALID_RESPONSE',
      'Некорректный ответ проверки прав кассы. Проверьте совместимость backend и POS.',
    );
  if (
    session.status !== 'ACTIVE' ||
    shift.status !== 'OPEN' ||
    session.register_id !== registerId ||
    shift.register_id !== registerId ||
    session.register_shift_id !== shift.id ||
    session.organization_id !== context.organizationId ||
    shift.organization_id !== context.organizationId ||
    session.store_id !== context.storeId ||
    shift.store_id !== context.storeId ||
    session.membership_id !== context.userOrganizationId
  )
    throw new PosError(
      'CASHIER_SESSION_NOT_ACTIVE',
      'Смена кассира недоступна.',
    );
}
