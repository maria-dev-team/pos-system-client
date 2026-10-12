import {
  type DiagnosticEvent,
  diagnosticPath,
  reportError,
  setDiagnosticSink,
} from '../../../../shared/diagnostics';
import { getAccessToken } from '../api/access-token.provider';
import { effectiveAuthContext } from '../helpers/access-token';

const owner = (): string | null =>
  getAccessToken() ? effectiveAuthContext(getAccessToken()) : null;
export const reportPosError = reportError;
let refreshContext: () => void = () => undefined;
export const refreshDiagnosticContext = (): void => refreshContext();
export function startErrorReporting(
  send: (events: DiagnosticEvent[]) => Promise<{ accepted_ids: string[] }>,
  getPage: () => string = () => location.pathname,
): () => void {
  const bridge = window.diagnostics;
  if (!bridge || typeof bridge.ready !== 'function') return () => undefined;
  let sending = false;
  let active = true;
  let context: string | null | undefined;
  let page: string | undefined;
  const syncContext = async (): Promise<string | null> => {
    if (!(await bridge.ready()) || !active) return null;
    const current = owner();
    const nextPage = diagnosticPath(getPage());
    if (context !== current || page !== nextPage) {
      await bridge.context(current, nextPage);
      context = current;
      page = nextPage;
    }
    return current;
  };
  refreshContext = () => {
    void syncContext().catch(() => undefined);
  };
  setDiagnosticSink((error) => {
    void bridge
      .report({ ...error, page: diagnosticPath(getPage()) }, owner())
      .catch(() => undefined);
  });
  const flush = async (): Promise<void> => {
    if (sending || !active) return;
    sending = true;
    try {
      const current = await syncContext();
      if (!current) return;
      const events = await bridge.pending(current);
      if (!events.length || current !== owner()) return;
      const result = await send(events);
      // A changed user cannot acknowledge or inherit another cashier's queue.
      if (current === owner())
        await bridge.acknowledge(current, result.accepted_ids);
    } catch {
      /* Offline queue is retried independently of sales and payments. */
    } finally {
      sending = false;
    }
  };
  const onError = (event: ErrorEvent): void =>
    reportError(
      event.error ?? { code: 'RESOURCE_LOAD_ERROR' },
      'renderer',
      'uncaught',
    );
  const onRejection = (event: PromiseRejectionEvent): void =>
    reportError(event.reason, 'renderer', 'unhandled');
  const onRetry = (event: MouseEvent): void => {
    const target =
      event.target instanceof Element
        ? event.target.closest('[data-error-retry]')
        : null;
    if (!target || target.matches(':disabled,[aria-disabled="true"]')) return;
    // Explicit retry controls re-arm only errors displayed on this screen.
    void bridge
      .retry({ page: diagnosticPath(getPage()) })
      .catch(() => undefined);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('online', flush);
  document.addEventListener('click', onRetry, true);
  const timer = setInterval(() => void flush(), 10000);
  const contextTimer = setInterval(
    () => void syncContext().catch(() => undefined),
    1000,
  );
  void flush();
  return () => {
    refreshContext = () => undefined;
    active = false;
    clearInterval(timer);
    clearInterval(contextTimer);
    setDiagnosticSink(() => undefined);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('online', flush);
    document.removeEventListener('click', onRetry, true);
  };
}
