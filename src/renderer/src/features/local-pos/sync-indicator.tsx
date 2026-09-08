import { CircleAlert, CircleCheck, Clock3, LoaderCircle } from 'lucide-react';

import type { SyncIndicator as Indicator } from './sync-indicators';

const icons = {
  working: LoaderCircle,
  ready: CircleCheck,
  waiting: Clock3,
  warning: CircleAlert,
};
const colors = {
  working: 'text-primary',
  ready: 'text-success',
  waiting: 'text-muted-foreground',
  warning: 'text-warning',
};

export function SyncIndicator({
  indicator,
  detailed = false,
}: {
  indicator: Indicator;
  detailed?: boolean;
}) {
  const Icon = icons[indicator.tone];
  return (
    <div
      title={indicator.detail}
      className="min-w-0"
      data-sync-state={indicator.tone}
      role={indicator.tone === 'working' ? 'progressbar' : undefined}
      aria-label={indicator.tone === 'working' ? indicator.label : undefined}
      aria-valuetext={
        indicator.tone === 'working' ? indicator.detail : undefined
      }
    >
      <p
        className={`flex items-center gap-1.5 text-xs font-medium ${colors[indicator.tone]}`}
      >
        <Icon
          aria-hidden="true"
          className={`size-3.5 shrink-0 ${indicator.tone === 'working' ? 'animate-spin motion-reduce:animate-none' : ''}`}
        />
        <span>{indicator.label}</span>
      </p>
      {detailed ? (
        <p className="mt-1 text-xs text-muted-foreground">{indicator.detail}</p>
      ) : null}
    </div>
  );
}
