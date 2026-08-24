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
  [ErrorCode.InvalidSession]: 'Сессия недействительна. Войдите снова.',
  [ErrorCode.InvalidToken]: 'Токен недействителен. Войдите снова.',
  [ErrorCode.OrganizationContextRequired]: 'Сначала выберите организацию.',
  [ErrorCode.StoreAccessDenied]: 'У вас нет доступа к этому магазину.',
  [ErrorCode.StoreContextRequired]: 'Сначала выберите магазин.',
  [ErrorCode.TooManyRequests]:
    'Слишком много попыток. Попробуйте немного позже.',
};

const getErrorCode = (error: unknown): ErrorCodeValue | undefined => {
  if (!axios.isAxiosError(error)) return undefined;
  return error.response?.data?.error_code as ErrorCodeValue | undefined;
};

export const getHttpErrorMessage = (
  error: unknown,
  fallback?: string,
): string => {
  const errorCode = getErrorCode(error);
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
