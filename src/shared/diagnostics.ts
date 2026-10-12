/** Only structural diagnostics cross this boundary: never error messages or request payloads. */
export type PosDiagnostic = {
  code: string;
  source: string;
  operation: string;
  operation_id?: string;
  trace_id?: string;
  page?: string;
  stack?: string;
};
export type DiagnosticEvent = PosDiagnostic & {
  id: string;
  timestamp: string;
  manual_retry: boolean;
  unassigned?: boolean;
  client_version?: string;
};
export type DiagnosticsBridge = {
  ready: () => Promise<boolean>;
  report: (error: PosDiagnostic, owner: string | null) => Promise<void>;
  context: (owner: string | null, page?: string) => Promise<void>;
  pending: (owner: string) => Promise<DiagnosticEvent[]>;
  acknowledge: (owner: string, ids: string[]) => Promise<void>;
  retry: (filter: {
    page?: string;
    source?: string;
    operation_id?: string;
  }) => Promise<void>;
};
const tag = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value)
    ? value
    : fallback;
export const diagnosticPath = (value: string): string =>
  value
    .split(/[?#]/)[0]!
    .split('/')
    .map((part) =>
      /^(?:v[0-9]+|[a-z][a-z_-]{0,40})$/i.test(part) ? part : part ? ':id' : '',
    )
    .join('/')
    .slice(0, 300);
export const diagnosticId = (value: unknown): string | undefined =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : undefined;
export function describeError(
  error: unknown,
  source: string,
  operation: string,
  operationId?: string,
): PosDiagnostic {
  const e = error as {
    code?: unknown;
    name?: unknown;
    stack?: unknown;
    traceId?: unknown;
    response?: {
      data?: { error_code?: unknown };
      headers?: Record<string, unknown>;
    };
  } | null;
  const code = tag(
    e?.response?.data?.error_code ?? e?.code ?? e?.name,
    'UNKNOWN_ERROR',
  );
  const statusError = code.startsWith('LOCAL_POS_STATUS_');
  return {
    code,
    source: statusError ? 'local' : tag(source, 'pos'),
    operation: statusError ? 'status' : diagnosticPath(operation),
    operation_id: diagnosticId(operationId),
    trace_id: diagnosticId(e?.traceId ?? e?.response?.headers?.['x-trace-id']),
    // Keep function names and line numbers; omit paths, messages and arguments.
    stack:
      typeof e?.stack === 'string'
        ? e.stack
            .split('\n')
            .slice(1, 9)
            .map((line) => {
              const frame =
                line.match(
                  /^\s*at ([A-Za-z_$][\w.$]*(?: \[as [\w$]+\])?)(?: |$)/,
                )?.[1] ?? 'anonymous';
              const location = line.match(/:(\d+):(\d+)\)?$/);
              return frame + (location ? `:${location[1]}:${location[2]}` : '');
            })
            .join('\n')
        : undefined,
  };
}
let sink: (diagnostic: PosDiagnostic, owner?: string | null) => void = () =>
  undefined;
const captured = new WeakSet<object>();
export const emitDiagnostic = (
  diagnostic: PosDiagnostic,
  owner?: string | null,
): void => {
  try {
    sink(diagnostic, owner);
  } catch {
    /* best effort */
  }
};
export const setDiagnosticSink = (next: typeof sink): void => {
  sink = next;
};
export function reportError(
  error: unknown,
  source: string,
  operation: string,
  operationId?: string,
): void {
  if (error && typeof error === 'object') {
    if (captured.has(error)) return;
    captured.add(error);
  }
  const diagnostic = describeError(error, source, operation, operationId);
  if (
    [
      'AUTH_CONTEXT_CHANGED',
      'LOCAL_CONTEXT_CHANGED',
      'ERR_CANCELED',
      'AbortError',
    ].includes(diagnostic.code)
  )
    return;
  try {
    sink(diagnostic);
  } catch {
    /* Reporting must never break a cash operation. */
  }
}
export const ignoreReportedError = (error: object): void => {
  captured.add(error);
};

let retrySink: (filter: {
  source?: string;
  operation_id?: string;
}) => void = () => undefined;
export const setDiagnosticRetrySink = (next: typeof retrySink): void => {
  retrySink = next;
};
export const retryDiagnostics = (filter: {
  source?: string;
  operation_id?: string;
}): void => {
  try {
    retrySink(filter);
  } catch {
    /* best effort */
  }
};

let contextReader: () => { owner: string | null; page?: string } = () => ({
  owner: null,
});
export const setDiagnosticContextReader = (
  reader: typeof contextReader,
): void => {
  contextReader = reader;
};
export const readDiagnosticContext = (): ReturnType<typeof contextReader> =>
  contextReader();
