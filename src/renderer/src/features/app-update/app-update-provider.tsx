/* eslint-disable react-refresh/only-export-components */
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';

import type { AppUpdateState } from '../../../../main/app-updater';
import { Button } from '../../common/components/ui/button';

const AppUpdateContext = createContext<AppUpdateState | undefined>(undefined);

export function useAppUpdateState(): AppUpdateState {
  const state = useContext(AppUpdateContext);
  if (!state) throw new Error('AppUpdateProvider is missing');
  return state;
}

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppUpdateState>();

  useEffect(() => {
    const appUpdates = window.appUpdates;
    if (!appUpdates) return;

    let active = true;
    let receivedUpdate = false;
    const unsubscribe = appUpdates.onStateChange((next) => {
      receivedUpdate = true;
      setState(next);
    });

    void appUpdates.getState().then((next) => {
      if (active && !receivedUpdate) setState(next);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const isTerminal = ['current', 'unchecked', 'outdated'].includes(
    state?.status ?? '',
  );

  return (
    <AppUpdateContext.Provider value={state}>
      {isTerminal ? (
        children
      ) : (
        <AppUpdateGate
          key={`${state?.status}:${state?.restartAt}`}
          state={state}
        />
      )}
    </AppUpdateContext.Provider>
  );
}

function AppUpdateGate({ state }: { state: AppUpdateState | undefined }) {
  const [now, setNow] = useState(Date.now);
  const percent = Math.min(
    100,
    Math.max(0, Math.round(state?.downloadPercent ?? 0)),
  );
  const seconds = Math.max(
    0,
    Math.ceil(((state?.restartAt ?? now) - now) / 1_000),
  );
  const transferred = formatMegabytes(state?.downloadTransferred);
  const total = formatMegabytes(state?.downloadTotal);

  useEffect(() => {
    if (!state?.restartAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [state?.restartAt]);

  return (
    <main className="grid min-h-svh place-items-center bg-workspace px-6 py-10">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-[var(--shadow-surface)]">
        <div className="relative mx-auto mb-6 grid size-16 place-items-center">
          <span className="absolute inset-0 animate-spin rounded-full border-4 border-primary border-r-transparent motion-reduce:animate-none" />
          <span className="grid size-10 place-items-center rounded-xl bg-primary font-extrabold text-primary-foreground">
            D
          </span>
        </div>
        <div aria-atomic="true" aria-live="polite" role="status">
          {state?.status === 'download-failed' ? (
            <>
              <h1 className="text-xl font-bold text-card-foreground">
                Не удалось скачать обновление
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Проверьте подключение к интернету и повторите загрузку.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Попытка {state.attempt}
              </p>
              <div className="mt-6 grid gap-3">
                <Button
                  onClick={() => {
                    void window.appUpdates?.retryDownload();
                  }}
                >
                  Повторить
                </Button>
                <Button
                  onClick={() => {
                    void window.appUpdates?.continueWithoutUpdate();
                  }}
                  variant="ghost"
                >
                  Продолжить без обновления
                </Button>
              </div>
            </>
          ) : state?.status === 'downloading' ? (
            <>
              <h1 className="text-xl font-bold text-card-foreground">
                Найдена версия v{state.availableVersion}. Загружаем обновление —{' '}
                {percent}%
              </h1>
              <div
                aria-label="Загрузка обновления"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={percent}
                className="mt-6 h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
              >
                <div
                  className="h-full bg-primary"
                  style={{ width: `${percent}%` }}
                />
              </div>
              {transferred !== null && total !== null ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {transferred} из {total} МБ
                </p>
              ) : null}
              <p className="mt-2 text-sm text-muted-foreground">
                Попытка {state.attempt}
              </p>
            </>
          ) : state?.status === 'restarting' ? (
            <h1 className="text-xl font-bold text-card-foreground">
              Обновление готово. Приложение перезапустится через {seconds}{' '}
              секунд
            </h1>
          ) : (
            <>
              <h1 className="text-xl font-bold text-card-foreground">
                Проверяем версию приложения
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Попытка {Math.max(1, state?.attempt ?? 1)} из 3
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function formatMegabytes(bytes: number | null | undefined): number | null {
  return bytes === null || bytes === undefined
    ? null
    : Math.round(bytes / 1024 / 1024);
}
