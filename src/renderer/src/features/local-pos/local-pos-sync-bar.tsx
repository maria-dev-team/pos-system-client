import { Button } from '@renderer/common/components/ui/button';

import { useLocalPosSync } from './local-pos-sync-context';
import { SyncIndicator } from './sync-indicator';
import { syncNotices } from './sync-indicators';

/** Compact global status: active work and warnings, without permanent success rows. */
export function LocalPosSyncBar() {
  const { active, state, issue, isChecking, refreshStatus } = useLocalPosSync();
  if (!active) return null;
  const indicators = issue
    ? [
        {
          id: 'unknown',
          tone: 'warning' as const,
          ...issue,
        },
      ]
    : state
      ? syncNotices(state)
      : [];
  if (!indicators.length) return null;
  return (
    <section
      aria-label="Синхронизация кассы"
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-card px-4 py-1.5 sm:px-5"
    >
      {indicators.map((indicator) => (
        <SyncIndicator
          key={indicator.id}
          indicator={indicator}
          detailed={Boolean(issue)}
        />
      ))}
      {issue ? (
        <Button
          type="button"
          variant="ghost"
          className="shrink-0"
          disabled={isChecking}
          onClick={refreshStatus}
        >
          {isChecking ? 'Проверяем статус…' : 'Повторить проверку статуса'}
        </Button>
      ) : null}
    </section>
  );
}
