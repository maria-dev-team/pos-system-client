import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';

import { getHttpErrorCode, getHttpErrorMessage } from './http-error.helper';

const responseError = (status: number, errorCode?: string): AxiosError =>
  new AxiosError('Request failed', undefined, undefined, undefined, {
    data: errorCode ? { error_code: errorCode } : {},
    headers: {},
    status,
    statusText: 'Error',
  } as AxiosResponse);

describe('getHttpErrorMessage', () => {
  it('returns a backend error code for recoverable feature flows', () => {
    expect(
      getHttpErrorCode(responseError(409, 'REGISTER_SHIFT_ALREADY_OPEN')),
    ).toBe('REGISTER_SHIFT_ALREADY_OPEN');
  });

  it.each([
    ['INVALID_CREDENTIALS', 'Неверный email, телефон или пароль.'],
    ['INSUFFICIENT_PERMISSIONS', 'У вас недостаточно прав для этого действия.'],
    [
      'CASHIER_SESSION_MUST_BE_ENDED',
      'Сначала завершите текущую кассовую сессию.',
    ],
    ['REGISTER_SHIFT_ALREADY_OPEN', 'Смена этой кассы уже открыта.'],
    ['REGISTER_SHIFT_ALREADY_CLOSED', 'Кассовая смена уже закрыта.'],
    [
      'REGISTER_SHIFT_CLOSE_FORBIDDEN',
      'Эту смену может закрыть только открывший её сотрудник.',
    ],
    [
      'REGISTER_SHIFT_HAS_CURRENT_CASHIER_SESSION',
      'Сначала завершите активную смену кассира.',
    ],
    ['REGISTER_SHIFT_NOT_FOUND', 'Кассовая смена не найдена.'],
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
