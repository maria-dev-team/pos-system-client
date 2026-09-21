import { PosError } from '../../shared/pos/contracts';

export const MAX_POS_RESPONSE_BYTES = 8 * 1024 * 1024;
const tooLarge = (): PosError =>
  new PosError(
    'POS_API_INVALID_RESPONSE',
    'Ответ сервера превышает допустимый размер. Локальные чеки сохранены; проверьте ограничение страниц на backend.',
  );

/** Bound decompressed bytes too; Content-Length alone cannot protect the worker. */
export async function readPosResponseJson(
  response: Response,
): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_POS_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty JSON response');
  let buffer = new Uint8Array(16 * 1024);
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const nextBytes = bytes + value.byteLength;
      if (nextBytes > MAX_POS_RESPONSE_BYTES) throw tooLarge();
      if (nextBytes > buffer.length) {
        const expanded = new Uint8Array(
          Math.min(
            MAX_POS_RESPONSE_BYTES,
            Math.max(nextBytes, buffer.length * 2),
          ),
        );
        expanded.set(buffer.subarray(0, bytes));
        buffer = expanded;
      }
      buffer.set(value, bytes);
      bytes = nextBytes;
    }
    return JSON.parse(new TextDecoder().decode(buffer.subarray(0, bytes)));
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
