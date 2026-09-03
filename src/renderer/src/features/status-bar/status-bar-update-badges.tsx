import { Badge } from '@renderer/common/components/ui/badge';

import type { AppUpdateState } from '../../../../main/app-updater';

export function StatusBarUpdateBadges({ state }: { state: AppUpdateState }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <Badge variant="secondary">v{state.currentVersion}</Badge>
      {state.status === 'unchecked' ? (
        <Badge className="border-transparent bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Не проверена
        </Badge>
      ) : state.status === 'outdated' ? (
        <Badge className="border-transparent bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">
          Устаревшая
        </Badge>
      ) : null}
    </span>
  );
}
