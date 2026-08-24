export type StatusBarItem =
  'context' | 'user' | 'serverStatus' | 'clock' | 'logout';

export type StatusBarConfig = {
  healthCheckIntervalMs: number;
  healthCheckTimeoutMs: number;
  leftItems: readonly StatusBarItem[];
  rightItems: readonly StatusBarItem[];
};

export const statusBarConfig = {
  healthCheckIntervalMs: 30_000,
  healthCheckTimeoutMs: 3_000,
  leftItems: ['context'],
  rightItems: ['user', 'serverStatus', 'clock', 'logout'],
} as const satisfies StatusBarConfig;
