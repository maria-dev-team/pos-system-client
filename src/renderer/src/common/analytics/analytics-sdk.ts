export type TelemetryEvent = {
  id: string;
  name: string;
  timestamp: string;
  page?: string;
  element?: string;
  duration_ms?: number;
  active_duration_ms?: number;
  value?: number;
  action_id?: string;
  operation_id?: string;
  client_version?: string;
};
export type TelemetryOptions = {
  send: (events: TelemetryEvent[]) => Promise<unknown>;
  owner: () => string | null;
  version: string;
};
export const normalizePage = (path: string) =>
  path
    .split(/[?#]/)[0]!
    .split('/')
    .map((part) =>
      /^(?:v[0-9]+|[a-z][a-z_-]{0,40})$/i.test(part) ? part : part ? ':id' : '',
    )
    .join('/')
    .slice(0, 300);

/** Bounded, memory-only telemetry. Never reads input values, text content or URLs with queries. */
export class AnalyticsSDK {
  private queue: TelemetryEvent[] = [];
  private identity: string | null;
  private page = '';
  private entered = performance.now();
  private active = 0;
  private lastTick = performance.now();
  private lastActivity = performance.now();
  private lastClick = { id: '', at: 0, count: 0 };
  private action?: { id: string; at: number };
  private sending = false;
  private timer?: ReturnType<typeof setInterval>;
  private flushTimer?: ReturnType<typeof setInterval>;
  private listeners: (() => void)[] = [];
  private observers: PerformanceObserver[] = [];
  private readonly options: TelemetryOptions;
  constructor(options: TelemetryOptions) {
    this.options = options;
    this.identity = options.owner();
  }
  private checkOwner() {
    const owner = this.options.owner();
    if (owner !== this.identity) {
      this.queue = [];
      this.identity = owner;
      this.entered = performance.now();
      this.active = 0;
      this.action = undefined;
      if (owner && this.page) this.track('page.view');
    }
    return owner;
  }
  track(
    name: string,
    fields: Omit<
      TelemetryEvent,
      'id' | 'name' | 'timestamp' | 'client_version'
    > = {},
  ) {
    if (!this.checkOwner() || this.queue.length >= 200) return;
    this.queue.push({
      ...fields,
      id: crypto.randomUUID(),
      name,
      timestamp: new Date().toISOString(),
      page: fields.page ? normalizePage(fields.page) : this.page,
      client_version: this.options.version,
    });
  }
  actionId() {
    this.checkOwner();
    return this.action && performance.now() - this.action.at < 5000
      ? this.action.id
      : undefined;
  }
  navigate(path: string) {
    const next = normalizePage(path);
    if (next === this.page) return;
    this.finishPage();
    this.page = next;
    this.entered = performance.now();
    this.active = 0;
    this.track('page.view');
  }
  private tick() {
    const now = performance.now();
    this.checkOwner();
    if (!document.hidden && now - this.lastActivity < 60000)
      this.active += Math.min(1000, now - this.lastTick);
    this.lastTick = now;
  }
  private finishPage() {
    this.tick();
    if (!this.page) return;
    const duration = Math.min(
      86400000,
      Math.max(0, performance.now() - this.entered),
    );
    this.track('page.activity', {
      duration_ms: duration,
      active_duration_ms: Math.min(this.active, duration),
    });
    this.entered = performance.now();
    this.active = 0;
  }
  async flush() {
    if (this.sending || !this.checkOwner() || !this.queue.length) return;
    this.queue = this.queue.filter(
      (event) =>
        Date.parse(event.timestamp) >= Date.now() - 86400000 &&
        Date.parse(event.timestamp) <= Date.now() + 60000,
    );
    if (!this.queue.length) return;
    const owner = this.identity;
    const batch = this.queue.splice(0, 50);
    this.sending = true;
    try {
      await this.options.send(batch);
    } catch {
      if (this.checkOwner() === owner)
        this.queue = [...batch, ...this.queue].slice(0, 200);
    } finally {
      this.sending = false;
    }
  }
  start() {
    this.navigate(location.pathname);
    const listen = (
      target: Window | Document,
      name: string,
      handler: EventListener,
    ) => {
      target.addEventListener(name, handler, { capture: true, passive: true });
      this.listeners.push(() =>
        target.removeEventListener(name, handler, true),
      );
    };
    for (const name of ['pointerdown', 'keydown', 'scroll'])
      listen(document, name, () => {
        this.lastActivity = performance.now();
      });
    listen(document, 'click', (event) => {
      this.action = { id: crypto.randomUUID(), at: performance.now() };
      const target =
        event.target instanceof Element
          ? event.target.closest('[data-analytics-id]')
          : null;
      const id = target?.getAttribute('data-analytics-id');
      if (!id || !/^[a-zA-Z0-9._-]{1,100}$/.test(id)) return;
      this.track('ui.click', { element: id, action_id: this.action.id });
      this.lastClick = {
        id,
        at: performance.now(),
        count:
          this.lastClick.id === id &&
          performance.now() - this.lastClick.at < 1000
            ? this.lastClick.count + 1
            : 1,
      };
      if (this.lastClick.count === 3)
        this.track('ui.rage_click', { element: id, action_id: this.action.id });
    });
    listen(document, 'submit', () =>
      this.track('form.submit', { action_id: this.actionId() }),
    );
    listen(document, 'invalid', () => this.track('form.validation'));
    listen(document, 'change', (event) => {
      const element =
        event.target instanceof Element
          ? event.target.getAttribute('data-analytics-id')
          : null;
      if (element && /^[a-zA-Z0-9._-]{1,100}$/.test(element))
        this.track('form.changed', { element });
    });
    listen(window, 'offline', () => this.track('network.offline'));
    listen(window, 'online', () => {
      this.track('network.online');
      void this.flush();
    });
    listen(document, 'visibilitychange', () => {
      if (document.hidden) {
        this.finishPage();
        void this.flush();
      }
    });
    listen(window, 'pagehide', () => {
      this.finishPage();
      void this.flush();
    });
    this.timer = setInterval(() => {
      this.tick();
      this.navigate(location.pathname);
    }, 1000);
    this.flushTimer = setInterval(() => {
      this.finishPage();
      void this.flush();
    }, 30000);
    if (typeof PerformanceObserver !== 'undefined') {
      for (const type of ['largest-contentful-paint', 'navigation']) {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            this.track(
              type === 'navigation'
                ? 'performance.navigation'
                : 'performance.lcp',
              {
                value: type === 'navigation' ? entry.duration : entry.startTime,
              },
            );
        });
        observer.observe({ type, buffered: true });
        this.observers.push(observer);
      }
    }
    return () => this.stop();
  }
  stop() {
    clearInterval(this.timer);
    clearInterval(this.flushTimer);
    for (const off of this.listeners) off();
    for (const observer of this.observers) observer.disconnect();
    this.listeners = [];
    this.observers = [];
  }
}
