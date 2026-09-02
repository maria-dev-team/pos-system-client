import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppUpdateState } from '../../../../main/app-updater';
import { AppUpdateProvider } from './app-update-provider';

const updateState = (
  overrides: Partial<AppUpdateState> = {},
): AppUpdateState => ({
  attempt: 1,
  availableVersion: null,
  currentVersion: '1.0.0',
  downloadPercent: null,
  restartAt: null,
  status: 'current',
  ...overrides,
});

const installUpdates = (initial: Promise<AppUpdateState>) => {
  let onStateChange: ((state: AppUpdateState) => void) | undefined;
  const unsubscribe = vi.fn();
  window.appUpdates = {
    getState: vi.fn(() => initial),
    onStateChange: vi.fn((callback) => {
      onStateChange = callback;
      return unsubscribe;
    }),
  };
  return {
    emit: (state: AppUpdateState) => onStateChange?.(state),
    unsubscribe,
  };
};

afterEach(() => {
  cleanup();
  delete window.appUpdates;
  vi.useRealTimers();
});

describe('AppUpdateProvider', () => {
  it('keeps children hidden before the initial update state arrives', () => {
    installUpdates(new Promise(() => undefined));

    render(
      <AppUpdateProvider>
        <p>router marker</p>
      </AppUpdateProvider>,
    );

    expect(screen.queryByText('router marker')).not.toBeInTheDocument();
    expect(screen.getByText('Проверяем версию приложения')).toBeInTheDocument();
  });

  it.each(['current', 'unchecked', 'outdated'] as const)(
    'renders children for the %s terminal state',
    async (status) => {
      installUpdates(Promise.resolve(updateState({ status })));

      render(
        <AppUpdateProvider>
          <p>router marker</p>
        </AppUpdateProvider>,
      );

      expect(await screen.findByText('router marker')).toBeInTheDocument();
    },
  );

  it('shows the branded loader and checking attempt', () => {
    const updates = installUpdates(new Promise(() => undefined));

    const { container } = render(
      <AppUpdateProvider>
        <p>router marker</p>
      </AppUpdateProvider>,
    );
    act(() => {
      updates.emit(updateState({ attempt: 2, status: 'checking' }));
    });

    expect(screen.getByText('D')).toHaveClass(
      'bg-primary',
      'text-primary-foreground',
    );
    expect(
      container.querySelector('.animate-spin.border-primary'),
    ).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toHaveClass(
      'motion-reduce:animate-none',
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByText('Попытка 2 из 3')).toBeInTheDocument();
  });

  it('shows pushed download progress with a rounded percentage', () => {
    const updates = installUpdates(new Promise(() => undefined));

    render(
      <AppUpdateProvider>
        <p>router marker</p>
      </AppUpdateProvider>,
    );

    act(() => {
      updates.emit(
        updateState({
          availableVersion: '2.0.0',
          downloadPercent: 47.6,
          status: 'downloading',
        }),
      );
    });

    expect(
      screen.getByText('Найдена версия v2.0.0. Загружаем обновление — 48%'),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '48',
    );
  });

  it('updates the restarting countdown from restartAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));
    const updates = installUpdates(new Promise(() => undefined));

    render(
      <AppUpdateProvider>
        <p>router marker</p>
      </AppUpdateProvider>,
    );

    act(() => {
      updates.emit(
        updateState({
          restartAt: Date.now() + 5_000,
          status: 'restarting',
        }),
      );
    });
    expect(
      screen.getByText(
        'Обновление готово. Приложение перезапустится через 5 секунд',
      ),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(
      screen.getByText(
        'Обновление готово. Приложение перезапустится через 4 секунд',
      ),
    ).toBeInTheDocument();
  });

  it('starts a delayed restarting state at its fresh five-second countdown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));
    const updates = installUpdates(new Promise(() => undefined));

    render(
      <AppUpdateProvider>
        <p>router marker</p>
      </AppUpdateProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
      updates.emit(
        updateState({
          restartAt: Date.now() + 5_000,
          status: 'restarting',
        }),
      );
    });

    expect(
      screen.getByText(
        'Обновление готово. Приложение перезапустится через 5 секунд',
      ),
    ).toBeInTheDocument();
  });

  it('keeps a pushed state when the initial getter resolves later', async () => {
    let resolveInitial: (state: AppUpdateState) => void;
    const updates = installUpdates(
      new Promise((resolve) => {
        resolveInitial = resolve;
      }),
    );

    render(
      <AppUpdateProvider>
        <p>router marker</p>
      </AppUpdateProvider>,
    );

    act(() => {
      updates.emit(
        updateState({
          availableVersion: '2.0.0',
          downloadPercent: 10,
          status: 'downloading',
        }),
      );
    });
    await act(async () => {
      resolveInitial!(updateState({ status: 'current' }));
    });

    expect(screen.queryByText('router marker')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '10',
    );
  });

  it('unsubscribes from preload state changes on unmount', () => {
    const updates = installUpdates(new Promise(() => undefined));

    const { unmount } = render(
      <AppUpdateProvider>
        <p>router marker</p>
      </AppUpdateProvider>,
    );
    unmount();

    expect(updates.unsubscribe).toHaveBeenCalledOnce();
  });
});
