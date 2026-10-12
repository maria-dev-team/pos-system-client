import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveApiUserDataPath } from './api-user-data';

describe('API storage isolation', () => {
  const root = join('/data', 'DukenAI POS');

  it('preserves the existing remote profile and its unsent receipts', () => {
    expect(resolveApiUserDataPath(root, 'https://api.example.com')).toBe(root);
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://127.1.2.3:3000',
    'http://[::1]:3000',
    'http://api.localhost:3000',
  ])('isolates the local backend %s from the remote profile', (apiUrl) => {
    const path = resolveApiUserDataPath(root, apiUrl);
    expect(path).not.toBe(root);
    expect(path.startsWith(join(root, 'local-api'))).toBe(true);
    expect(resolveApiUserDataPath(root, `${apiUrl}/`)).toBe(path);
  });

  it('keeps separate local ports and base paths in separate profiles', () => {
    const paths = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3000/api',
    ].map((apiUrl) => resolveApiUserDataPath(root, apiUrl));
    expect(new Set(paths).size).toBe(paths.length);
  });
});
