const messages: Readonly<Record<string, string>> = {
  CASH_RECEIVED_INSUFFICIENT:
    'Полученной суммы недостаточно для оплаты наличными.',
  DATABASE_TEMPORARILY_UNAVAILABLE:
    'База данных временно недоступна. Повторите операцию позже.',
  DUPLICATE_PAYMENT_METHOD:
    'Нельзя использовать один способ оплаты несколько раз.',
  FISCALIZATION_DATA_INVALID:
    'Для фискального чека не заполнены обязательные данные.',
  FISCALIZATION_NOT_CONFIGURED:
    'Для этой кассы не настроен фискальный провайдер.',
  FISCALIZATION_OPERATION_NOT_SUPPORTED:
    'Эта операция не поддерживается фискальным провайдером.',
  FISCALIZATION_REJECTED:
    'Фискальный провайдер отклонил операцию. Проверьте данные и повторите.',
  FISCALIZATION_UNAVAILABLE:
    'Фискальный провайдер временно недоступен. Повторите операцию позже.',
  FISCAL_SHIFT_EXPIRED:
    'Фискальная смена превысила 24 часа. Закройте кассовую смену.',
  INSUFFICIENT_PERMISSIONS: 'У вас недостаточно прав для этого действия.',
  INSUFFICIENT_STOCK: 'Недостаточно товара на складе.',
  PAYMENT_AMOUNT_INVALID: 'Указана некорректная сумма оплаты.',
  PAYMENT_AMOUNT_MISMATCH: 'Сумма оплат должна совпадать с суммой продажи.',
  PAYMENT_DETAILS_INVALID: 'Указаны некорректные данные оплаты.',
  REGISTER_SHIFT_NOT_OPEN: 'Кассовая смена уже закрыта.',
  SALE_EMPTY: 'Продажа пуста. Добавьте хотя бы один товар.',
  SALE_NOT_EDITABLE: 'Эту продажу нельзя изменить.',
  SALE_NOT_FOUND: 'Продажа не найдена.',
  SALE_TOTAL_ZERO: 'Сумма продажи должна быть больше нуля.',
  SALE_VERSION_CONFLICT:
    'Продажа уже изменилась. Обновите данные и повторите действие.',
};

export const serverErrorMessage = (code: string): string | null =>
  messages[code] ?? null;
