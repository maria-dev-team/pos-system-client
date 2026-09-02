import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { AppRouter } from '@renderer/common/router';

import type { AppUpdateState } from '../../main/app-updater';
import App from './App';

vi.mock('@tanstack/react-router', () => ({
  RouterProvider: () => <p>router marker</p>,
}));

afterEach(() => {
  cleanup();
  delete window.appUpdates;
});

it('places the update gate above the router', () => {
  window.appUpdates = {
    getState: vi.fn(() => new Promise<AppUpdateState>(() => undefined)),
    onStateChange: vi.fn(() => vi.fn()),
  };

  render(<App router={{} as AppRouter} />);

  expect(screen.queryByText('router marker')).not.toBeInTheDocument();
  expect(screen.getByText('Проверяем версию приложения')).toBeInTheDocument();
});
