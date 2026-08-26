import { vi } from 'vitest';

window.scrollTo = vi.fn();

if (typeof window.localStorage.setItem !== 'function') {
  const data = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => data.clear(),
      getItem: (key: string) => data.get(key) ?? null,
      removeItem: (key: string) => data.delete(key),
      setItem: (key: string, value: string) => data.set(key, value),
    },
  });
}
