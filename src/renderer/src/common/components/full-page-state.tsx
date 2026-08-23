import { LoaderCircle } from 'lucide-react';

import { Button } from './ui/button';

type FullPageStateProps = {
  description?: string;
  isLoading?: boolean;
  onRetry?: () => void;
  title: string;
};

export function FullPageState({
  description,
  isLoading = false,
  onRetry,
  title,
}: FullPageStateProps) {
  return (
    <main className="grid min-h-svh place-items-center bg-workspace px-6 py-10">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-[var(--shadow-surface)]">
        {isLoading ? (
          <LoaderCircle
            aria-hidden="true"
            className="mx-auto mb-4 size-6 animate-spin text-primary"
          />
        ) : null}
        <h1 className="text-xl font-bold text-card-foreground">{title}</h1>
        {description ? (
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        ) : null}
        {onRetry ? (
          <Button className="mt-6" onClick={onRetry} type="button">
            Повторить
          </Button>
        ) : null}
      </section>
    </main>
  );
}
