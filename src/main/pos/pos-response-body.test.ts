// @vitest-environment node
import { expect, it, vi } from 'vitest';

import {
  MAX_POS_RESPONSE_BYTES,
  readPosResponseJson,
} from './pos-response-body';

it('rejects a declared oversized body without parsing it', async () => {
  await expect(
    readPosResponseJson(
      new Response('{}', {
        headers: { 'content-length': String(MAX_POS_RESPONSE_BYTES + 1) },
      }),
    ),
  ).rejects.toMatchObject({ code: 'POS_API_INVALID_RESPONSE' });
});
it('bounds streamed bytes even if Content-Length is missing or wrong', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel,
  });
  await expect(
    readPosResponseJson(
      new Response(body, { headers: { 'content-length': '1' } }),
    ),
  ).rejects.toMatchObject({ code: 'POS_API_INVALID_RESPONSE' });
  expect(cancel).toHaveBeenCalledOnce();
});
it('decodes Cyrillic UTF-8 split across network chunks', async () => {
  const bytes = new TextEncoder().encode('{"name":"Молоко"}');
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  await expect(readPosResponseJson(new Response(body))).resolves.toEqual({
    name: 'Молоко',
  });
});
