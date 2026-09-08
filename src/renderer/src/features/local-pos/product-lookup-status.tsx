import { LoaderCircle } from 'lucide-react';

import { useLocalPosSync } from './local-pos-sync-context';

export function ProductLookupStatus() {
  const { state } = useLocalPosSync();
  if (!state?.productLookups) return null;
  return (
    <p
      role="status"
      className="mt-2 flex items-center gap-2 text-sm text-primary"
    >
      <LoaderCircle
        aria-hidden="true"
        className="size-4 animate-spin motion-reduce:animate-none"
      />
      Ищем на сервере и сохраняем на кассе · запросов: {state.productLookups}.
      Можно сканировать следующий товар.
    </p>
  );
}
