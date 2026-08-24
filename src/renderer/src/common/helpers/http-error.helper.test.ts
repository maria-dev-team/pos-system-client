import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';

import { getHttpErrorMessage } from './http-error.helper';

const responseError = (status: number, errorCode?: string): AxiosError =>
  new AxiosError('Request failed', undefined, undefined, undefined, {
    data: errorCode ? { error_code: errorCode } : {},
    headers: {},
    status,
    statusText: 'Error',
  } as AxiosResponse);

describe('getHttpErrorMessage', () => {
  it.each([
    ['INVALID_CREDENTIALS', 'Неверный email, телефон или пароль.'],
    ['INSUFFICIENT_PERMISSIONS', 'У вас недостаточно прав для этого действия.'],
    [
      'CASHIER_SESSION_MUST_BE_ENDED',
      'Сначала завершите текущую кассовую сессию.',
    ],
    ['TOO_MANY_REQUESTS', 'Слишком много попыток. Попробуйте немного позже.'],
  ])('maps %s to a human-readable message', (code, message) => {
    expect(getHttpErrorMessage(responseError(400, code))).toBe(message);
  });

  it('describes timeout, network and server errors', () => {
    expect(
      getHttpErrorMessage(new AxiosError('timeout', 'ECONNABORTED')),
    ).toContain('Сервер отвечает слишком долго');
    expect(
      getHttpErrorMessage(new AxiosError('network', 'ERR_NETWORK')),
    ).toContain('Нет соединения с сервером');
    expect(getHttpErrorMessage(responseError(500))).toContain(
      'Сервис временно недоступен',
    );
  });
});
