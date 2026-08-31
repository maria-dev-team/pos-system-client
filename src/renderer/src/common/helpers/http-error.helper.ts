import axios from 'axios';
import { toast } from 'sonner';

import {
  ErrorCode,
  type ErrorCode as ErrorCodeValue,
} from '../constants/error-code';

const messages: Record<ErrorCodeValue, string> = {
  [ErrorCode.CashierSessionForbidden]:
    'Вы не можете управлять сменой другого кассира.',
  [ErrorCode.CashierSessionHasOpenSales]:
    'Сначала завершите или отмените открытые продажи.',
  [ErrorCode.CashierSessionInvalidTransition]: 'Смена кассира уже завершена.',
  [ErrorCode.CashierSessionMembershipOccupied]:
    'У вас уже открыта смена кассира на другой кассе.',
  [ErrorCode.CashierSessionMustBeEnded]:
    'Сначала завершите текущую кассовую сессию.',
  [ErrorCode.CashierSessionNotActive]: 'Смена кассира не активна.',
  [ErrorCode.CashierSessionNotFound]: 'Смена кассира не найдена.',
  [ErrorCode.CashierSessionRegisterOccupied]:
    'На этой кассе уже работает другой кассир.',
  [ErrorCode.CashRefundInsufficient]:
    'В кассе недостаточно наличных для возврата.',
  [ErrorCode.FiscalizationDataInvalid]:
    'Для фискального чека не заполнены обязательные данные.',
  [ErrorCode.FiscalizationNotConfigured]:
    'Для этой кассы не настроен фискальный провайдер.',
  [ErrorCode.FiscalizationRejected]:
    'Фискальный провайдер отклонил чек. Проверьте данные и повторите операцию.',
  [ErrorCode.FiscalizationUnavailable]:
    'Фискальный провайдер временно недоступен. Оплата не завершена.',
  [ErrorCode.FiscalShiftExpired]:
    'Фискальная смена превысила 24 часа. Завершите смену кассира и закройте кассовую смену.',
  [ErrorCode.IncorrectOrganization]: 'Выбран неверный контекст организации.',
  [ErrorCode.InsufficientPermissions]:
    'У вас недостаточно прав для этого действия.',
  [ErrorCode.InvalidCredentials]: 'Неверный email, телефон или пароль.',
  [ErrorCode.InvalidCashAmount]: 'Указана некорректная сумма наличных.',
  [ErrorCode.InvalidSession]: 'Сессия недействительна. Войдите снова.',
  [ErrorCode.InvalidToken]: 'Токен недействителен. Войдите снова.',
  [ErrorCode.OrganizationContextRequired]: 'Сначала выберите организацию.',
  [ErrorCode.RegisterNotActive]: 'Эта касса неактивна.',
  [ErrorCode.RegisterNotFound]: 'Касса не найдена.',
  [ErrorCode.RegisterShiftAlreadyClosed]: 'Кассовая смена уже закрыта.',
  [ErrorCode.RegisterShiftAlreadyOpen]: 'Смена этой кассы уже открыта.',
  [ErrorCode.RegisterShiftCloseForbidden]:
    'Эту смену может закрыть только открывший её сотрудник.',
  [ErrorCode.RegisterShiftHasCurrentCashierSession]:
    'Сначала завершите активную смену кассира.',
  [ErrorCode.RegisterShiftNotFound]: 'Кассовая смена не найдена.',
  [ErrorCode.RegisterShiftNotOpen]: 'Кассовая смена уже закрыта.',
  [ErrorCode.ReceiptNotFound]: 'Чек не найден.',
  [ErrorCode.ReceiptNumberInvalid]: 'Указан некорректный номер чека.',
  [ErrorCode.ReturnIdempotencyConflict]:
    'Сохранённую команду возврата нельзя изменить.',
  [ErrorCode.ReturnIdempotencyKeyInvalid]:
    'Не удалось создать идентификатор возврата.',
  [ErrorCode.ReturnPriceOverrideSameValue]:
    'Новая цена должна отличаться от цены каталога.',
  [ErrorCode.ReturnQuantityExceeded]:
    'Количество превышает доступное для возврата.',
  [ErrorCode.ReturnAmountNotRepresentable]:
    'Сумму частичного возврата нельзя корректно распределить. Измените количество.',
  [ErrorCode.ReturnTotalZero]: 'Сумма возврата должна быть больше нуля.',
  [ErrorCode.SaleAmountOverflow]: 'Сумма продажи слишком велика.',
  [ErrorCode.SaleCancellationReasonInvalid]:
    'Укажите корректную причину отмены продажи.',
  [ErrorCode.SaleDraftAlreadyExists]: 'У вас уже есть открытая продажа.',
  [ErrorCode.SaleDiscountNotApplicable]:
    'Эту скидку нельзя применить к текущей сумме чека.',
  [ErrorCode.SaleDiscountPercentageInvalid]:
    'Укажите скидку больше 0 и меньше 100 процентов.',
  [ErrorCode.SaleDiscountReasonInvalid]:
    'Укажите причину скидки не короче 3 символов.',
  [ErrorCode.SaleEmpty]: 'Продажа пуста. Добавьте хотя бы один товар.',
  [ErrorCode.SaleHeldLimitExceeded]: 'Достигнут лимит отложенных продаж.',
  [ErrorCode.SaleItemLimitExceeded]: 'Достигнут лимит позиций в продаже.',
  [ErrorCode.SaleItemNotFound]: 'Позиция продажи не найдена.',
  [ErrorCode.SaleNotEditable]: 'Эту продажу нельзя изменить.',
  [ErrorCode.SaleNotFound]: 'Продажа не найдена.',
  [ErrorCode.SalePriceOverrideSameValue]:
    'Новая цена совпадает с текущей ценой товара.',
  [ErrorCode.SaleVersionConflict]:
    'Продажа уже изменилась. Обновите данные и повторите действие.',
  [ErrorCode.SaleTotalZero]: 'Сумма продажи должна быть больше нуля.',
  [ErrorCode.CashReceivedInsufficient]:
    'Полученной суммы недостаточно для оплаты наличными.',
  [ErrorCode.DuplicatePaymentMethod]:
    'Нельзя использовать один способ оплаты несколько раз.',
  [ErrorCode.InsufficientStock]: 'Недостаточно товара на складе.',
  [ErrorCode.PaymentAmountInvalid]: 'Указана некорректная сумма оплаты.',
  [ErrorCode.PaymentAmountMismatch]:
    'Сумма оплат должна совпадать с суммой продажи.',
  [ErrorCode.PaymentDetailsInvalid]: 'Указаны некорректные данные оплаты.',
  [ErrorCode.ProductNotFound]: 'Товар не найден.',
  [ErrorCode.ProductNotSellable]: 'Этот товар нельзя продавать.',
  [ErrorCode.ProductMarkingCodeDuplicate]:
    'Этот Data Matrix уже добавлен в чек.',
  [ErrorCode.ProductMarkingCodeNotAllowed]:
    'Data Matrix нельзя указать для немаркированного товара.',
  [ErrorCode.ProductMarkingCodeRequired]:
    'Отсканируйте Data Matrix маркированного товара.',
  [ErrorCode.ProductNktRequired]:
    'Для продажи товара необходимо выбрать запись НКТ.',
  [ErrorCode.ProductSalePriceRequired]: 'Для товара не указана цена продажи.',
  [ErrorCode.InvalidProductQuantity]: 'Указано некорректное количество товара.',
  [ErrorCode.StoreAccessDenied]: 'У вас нет доступа к этому магазину.',
  [ErrorCode.StoreContextRequired]: 'Сначала выберите магазин.',
  [ErrorCode.SupportUnavailable]:
    'Служба поддержки временно недоступна. Повторите попытку позже.',
  [ErrorCode.TooManyRequests]:
    'Слишком много попыток. Попробуйте немного позже.',
};

export const getHttpErrorCode = (
  error: unknown,
): ErrorCodeValue | undefined => {
  if (!axios.isAxiosError(error)) return undefined;
  return error.response?.data?.error_code as ErrorCodeValue | undefined;
};

export const getHttpErrorMessage = (
  error: unknown,
  fallback?: string,
): string => {
  const errorCode = getHttpErrorCode(error);
  if (errorCode && messages[errorCode]) return messages[errorCode];
  if (!axios.isAxiosError(error)) return fallback ?? 'Произошла ошибка.';

  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return 'Сервер отвечает слишком долго. Проверьте интернет и повторите запрос.';
  }
  if (!error.response) {
    return 'Нет соединения с сервером. Проверьте интернет и повторите запрос.';
  }
  if (error.response.status >= 500) {
    return 'Сервис временно недоступен. Повторите запрос немного позже.';
  }

  return fallback ?? 'Не удалось выполнить запрос.';
};

export const httpErrorHandler = (
  error: unknown,
  fallback?: string,
  toastId?: string,
): void => {
  toast.error(getHttpErrorMessage(error, fallback), { id: toastId });
};
