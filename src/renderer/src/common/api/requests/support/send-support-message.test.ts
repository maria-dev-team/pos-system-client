import { afterEach, describe, expect, it, vi } from 'vitest';

import { request } from '../../request';
import { sendSupportMessage } from './send-support-message';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendSupportMessage', () => {
  it('posts the message to the authenticated support endpoint', async () => {
    const post = vi.spyOn(request, 'post').mockResolvedValue({} as never);

    await sendSupportMessage({ message: 'Нужна помощь' });

    expect(post).toHaveBeenCalledWith('/v1/support/messages', {
      message: 'Нужна помощь',
    });
  });
});
