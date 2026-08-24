import axios from 'axios';
import { toast } from 'sonner';

import {
  ErrorCode,
  type ErrorCode as ErrorCodeValue,
} from '../constants/error-code';

const messages: Record<ErrorCodeValue, string> = {
  [ErrorCode.CashierSessionMustBeEnded]:
    'Сначала завершите текущую кассовую сессию.',
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
  [ErrorCode.StoreAccessDenied]: 'У вас нет доступа к этому магазину.',
  [ErrorCode.StoreContextRequired]: 'Сначала выберите магазин.',
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
