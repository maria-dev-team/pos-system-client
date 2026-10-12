/** One printer job at a time, with a bounded queue shared by all windows/buttons. */
let active = false;
const waiting: Array<() => void> = [];
export async function queuePrint<T>(operation: () => Promise<T>): Promise<T> {
  if (active) {
    if (waiting.length >= 3)
      throw new Error('Очередь печати заполнена. Дождитесь завершения печати.');
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else active = true;
  try {
    return await operation();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active = false;
  }
}

export async function printDeadline<T>(
  operation: Promise<T>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Подготовка печати не завершилась вовремя.')),
          Math.max(1, ms),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
