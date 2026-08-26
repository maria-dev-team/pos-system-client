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
    ['CASHIER_SESSION_NOT_FOUND', 'Смена кассира не найдена.'],
    [
      'CASHIER_SESSION_FORBIDDEN',
      'Вы не можете управлять сменой другого кассира.',
    ],
    [
      'CASHIER_SESSION_REGISTER_OCCUPIED',
      'На этой кассе уже работает другой кассир.',
    ],
    [
      'CASHIER_SESSION_MEMBERSHIP_OCCUPIED',
      'У вас уже открыта смена кассира на другой кассе.',
    ],
    ['CASHIER_SESSION_INVALID_TRANSITION', 'Смена кассира уже завершена.'],
    ['CASHIER_SESSION_NOT_ACTIVE', 'Смена кассира не активна.'],
    [
      'CASHIER_SESSION_HAS_OPEN_SALES',
      'Сначала завершите или отмените открытые продажи.',
    ],
    ['SALE_NOT_FOUND', 'Продажа не найдена.'],
    ['SALE_EMPTY', 'Продажа пуста. Добавьте хотя бы один товар.'],
    ['SALE_HELD_LIMIT_EXCEEDED', 'Достигнут лимит отложенных продаж.'],
    ['SALE_DRAFT_ALREADY_EXISTS', 'У вас уже есть открытая продажа.'],
    ['SALE_TOTAL_ZERO', 'Сумма продажи должна быть больше нуля.'],
    ['SALE_NOT_EDITABLE', 'Эту продажу нельзя изменить.'],
    [
      'SALE_VERSION_CONFLICT',
      'Продажа уже изменилась. Обновите данные и повторите действие.',
    ],
    ['SALE_ITEM_NOT_FOUND', 'Позиция продажи не найдена.'],
    ['PRODUCT_NOT_FOUND', 'Товар не найден.'],
    ['PRODUCT_NOT_SELLABLE', 'Этот товар нельзя продавать.'],
    ['PRODUCT_SALE_PRICE_REQUIRED', 'Для товара не указана цена продажи.'],
    ['INVALID_PRODUCT_QUANTITY', 'Указано некорректное количество товара.'],
    ['INSUFFICIENT_STOCK', 'Недостаточно товара на складе.'],
    ['PAYMENT_AMOUNT_INVALID', 'Указана некорректная сумма оплаты.'],
    [
      'PAYMENT_AMOUNT_MISMATCH',
      'Сумма оплат должна совпадать с суммой продажи.',
    ],
    ['PAYMENT_DETAILS_INVALID', 'Указаны некорректные данные оплаты.'],
    [
      'CASH_RECEIVED_INSUFFICIENT',
      'Полученной суммы недостаточно для оплаты наличными.',
    ],
    [
      'DUPLICATE_PAYMENT_METHOD',
      'Нельзя использовать один способ оплаты несколько раз.',
    ],
    ['SALE_ITEM_LIMIT_EXCEEDED', 'Достигнут лимит позиций в продаже.'],
    ['SALE_AMOUNT_OVERFLOW', 'Сумма продажи слишком велика.'],
    [
      'SALE_PRICE_OVERRIDE_SAME_VALUE',
      'Новая цена совпадает с текущей ценой товара.',
    ],
    [
      'SALE_CANCELLATION_REASON_INVALID',
      'Укажите корректную причину отмены продажи.',
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
    ['REGISTER_SHIFT_NOT_OPEN', 'Кассовая смена уже закрыта.'],
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
