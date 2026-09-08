import type { QueryClient } from '@tanstack/react-query';

import type {
  PosProfile,
  PosRequest,
  PosResult,
  SaleCommand,
  SaleResponse,
} from '../../../../shared/pos/contracts';
import { PosError } from '../../../../shared/pos/contracts';
import { getAccessToken } from '../api/access-token.provider';
import { refreshAccessToken } from '../api/request';
import { queryKeys } from '../constants/query-keys';

let profile: PosProfile | null = null;
let token: string | null = null;
let connecting: {
  accessToken: string;
  registerId: string;
  force: boolean;
  promise: Promise<PosProfile>;
} | null = null;
const needsTokenRefresh = (error: unknown): boolean =>
  error instanceof PosError &&
  ['INVALID_TOKEN', 'INVALID_SESSION'].includes(error.code);

export async function callLocalPos<T extends PosResult = PosResult>(
  request: PosRequest,
): Promise<T> {
  if (!window.localPos)
    throw new PosError('LOCAL_UNAVAILABLE', 'Локальное хранилище недоступно.');
  const reply = await window.localPos.request(request);
  if (!reply.ok) throw new PosError(reply.code, reply.message);
  return reply.value as T;
}
export const localPosActive = () => Boolean(window.localPos && profile);
export const localPosProfile = () => profile;

export async function connectLocalPos(
  registerId: string,
  force = false,
): Promise<PosProfile> {
  const accessToken = getAccessToken();
  if (!accessToken) throw new PosError('INVALID_SESSION', 'Войдите в систему.');
  if (
    !force &&
    profile?.session.register_id === registerId &&
    token === accessToken &&
    profile.expiresAt > Date.now()
  )
    return profile;
  if (connecting) {
    if (
      connecting.accessToken === accessToken &&
      connecting.registerId === registerId &&
      (!force || connecting.force)
    )
      return connecting.promise;
    await connecting.promise.catch(() => undefined);
    return connectLocalPos(registerId, force);
  }
  const promise = (async (): Promise<PosProfile> => {
    let verifiedToken = accessToken;
    let connected: PosProfile;
    try {
      connected = await callLocalPos<PosProfile>({
        type: 'connect',
        accessToken: verifiedToken,
        registerId,
        ...(force ? { forceOnline: true } : {}),
      });
    } catch (error) {
      if (!needsTokenRefresh(error)) throw error;
      // Only authentication is retried here, never a payment or sale command.
      // Use the same single-flight refresh as ordinary HTTP requests.
      const latest = getAccessToken();
      if (!latest) throw error;
      verifiedToken =
        latest !== accessToken ? latest : await refreshAccessToken();
      connected = await callLocalPos<PosProfile>({
        type: 'connect',
        accessToken: verifiedToken,
        registerId,
        forceOnline: true,
      });
    }
    if (getAccessToken() !== verifiedToken)
      throw new PosError(
        'LOCAL_CONTEXT_CHANGED',
        'Авторизация изменилась во время проверки кассы. Повторите вход в смену.',
      );
    profile = connected;
    token = verifiedToken;
    return connected;
  })();
  const job = { accessToken, registerId, force, promise };
  connecting = job;
  try {
    return await promise;
  } finally {
    if (connecting === job) connecting = null;
  }
}

export async function restoreLocalPos(
  queryClient: QueryClient,
): Promise<PosProfile | null> {
  const accessToken = getAccessToken();
  if (!window.localPos || !accessToken) return null;
  let restored: PosProfile | null;
  try {
    restored = await callLocalPos<PosProfile | null>({
      type: 'restore',
      accessToken,
    });
  } catch (error) {
    if (!needsTokenRefresh(error)) throw error;
    if (getAccessToken() === accessToken) await refreshAccessToken();
    // The new token is not trusted against the old offline grant. The router
    // reloads the active register/session online before reconnecting.
    return null;
  }
  if (!restored) return null;
  if (getAccessToken() !== accessToken)
    throw new PosError(
      'LOCAL_CONTEXT_CHANGED',
      'Авторизация изменилась во время восстановления кассы.',
    );
  profile = restored;
  token = accessToken;
  queryClient.setQueryData(queryKeys.auth.context(), restored.context);
  queryClient.setQueryData(
    queryKeys.cashierSessions.current(restored.session.register_id),
    restored.session,
  );
  queryClient.setQueryData(
    queryKeys.registerShifts.current(restored.session.register_id),
    restored.shift,
  );
  return restored;
}

export async function disconnectLocalPos(): Promise<void> {
  if (localPosActive()) await callLocalPos({ type: 'disconnect' });
  profile = null;
  token = null;
}
export async function executeLocalSale(
  command: SaleCommand,
): Promise<SaleResponse> {
  if (profile && token !== getAccessToken())
    await connectLocalPos(profile.session.register_id);
  return callLocalPos<SaleResponse>({ type: 'execute', command });
}
