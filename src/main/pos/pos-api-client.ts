import { PosError } from '../../shared/pos/contracts';
import {
  type FiscalErrorDetails,
  fiscalErrorMessage,
} from '../../shared/pos/fiscal-error';
import { serverErrorMessage } from '../../shared/pos/server-error-message';
import { readPosResponseJson } from './pos-response-body';

export class PosApiError extends PosError {
  constructor(
    code: string,
    readonly status: number,
    readonly details: FiscalErrorDetails = {},
    readonly retryAfterMs = 0,
  ) {
    super(
      code,
      fiscalErrorMessage(details) ??
        serverErrorMessage(code) ??
        (status === 401
          ? 'Нужно обновить авторизацию кассы и повторно проверить доступ к смене.'
          : status === 403
            ? 'Сервер запретил доступ к кассе. Проверьте права пользователя.'
            : status >= 500
              ? 'Сервер временно недоступен.'
              : 'Сервер отклонил операцию.'),
    );
  }
}

/** Transport errors are distinct from invalid responses and programming/storage errors. */
export class PosConnectionError extends PosError {}

export async function requestPosApi<T>(
  fetcher: typeof fetch,
  apiUrl: string,
  token: string,
  path: string,
  body: unknown,
  timeout: number,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`${apiUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name);
    throw new PosConnectionError(
      timedOut ? 'POS_API_TIMEOUT' : 'POS_API_UNREACHABLE',
      timedOut
        ? `Сервер кассы не ответил за ${timeout / 1000} секунд (${path.split('?')[0]}). Повторите проверку соединения.`
        : `Локальный модуль не смог подключиться к серверу ${new URL(apiUrl).origin}. Проверьте адрес API, доступность сервера и сетевые настройки.`,
    );
  }
  if (response.status === 204) return undefined as T;
  let parsed: unknown;
  try {
    parsed = await readPosResponseJson(response);
  } catch (error) {
    if (!response.ok)
      throw new PosApiError(
        'POS_API_ERROR',
        response.status,
        {},
        retryAfter(response),
      );
    if (error instanceof PosError) throw error;
    if (
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name)
    )
      throw new PosConnectionError(
        'POS_API_TIMEOUT',
        'Сервер не закончил передачу ответа вовремя. Повторите проверку соединения.',
      );
    throw new PosError(
      'POS_API_INVALID_RESPONSE',
      `Сервер вернул не JSON (HTTP ${response.status}, ${path.split('?')[0]}). Проверьте адрес API и конфигурацию backend.`,
    );
  }
  if (!response.ok) {
    const error =
      parsed && typeof parsed === 'object'
        ? (parsed as FiscalErrorDetails & { error_code?: string })
        : {};
    throw new PosApiError(
      error.error_code ??
        (response.status === 401 ? 'INVALID_TOKEN' : 'POS_API_ERROR'),
      response.status,
      error,
      retryAfter(
        response,
        (error as { retry_after_seconds?: unknown }).retry_after_seconds,
      ),
    );
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('data' in parsed) ||
    !parsed.data ||
    typeof parsed.data !== 'object'
  )
    throw new PosError(
      'POS_API_INVALID_RESPONSE',
      `Некорректный ответ сервера (${path.split('?')[0]}): отсутствует data. Проверьте совместимость backend и POS.`,
    );
  return parsed.data as T;
}

function retryAfter(response: Response, seconds?: unknown): number {
  const header = response.headers.get('retry-after');
  const headerMs = header
    ? /^\d+(?:\.\d+)?$/.test(header)
      ? Number(header) * 1000
      : Date.parse(header) - Date.now()
    : 0;
  const bodyMs =
    typeof seconds === 'number' && Number.isFinite(seconds)
      ? seconds * 1000
      : 0;
  // Bound untrusted server metadata, including dates far in the future.
  return Math.min(
    24 * 60 * 60_000,
    Math.max(0, Number.isFinite(headerMs) ? headerMs : 0, bodyMs),
  );
}
