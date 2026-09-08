import { Button } from '@renderer/common/components/ui/button';

import { useLocalPosSync } from './local-pos-sync-context';
import { SyncIndicator } from './sync-indicator';
import { syncIndicators } from './sync-indicators';

/** Always mounted above the routed workspace, including history and returns. */
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
      ? syncIndicators(state)
      : [
          {
            id: 'loading',
            tone: 'working' as const,
            label: 'Проверяем синхронизацию…',
            detail: 'Получаем состояние локального хранилища.',
          },
        ];
  return (
    <section
      aria-label="Синхронизация кассы"
      className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-border bg-card px-4 py-2 sm:px-5"
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
