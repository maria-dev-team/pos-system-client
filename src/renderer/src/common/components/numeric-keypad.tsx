import { Delete, Eraser } from 'lucide-react';

import { Button } from './ui/button';

const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '.'];

type NumericKeypadProps = {
  disabled?: boolean;
  onValueChange: (value: string) => void;
  value: string;
};

export function NumericKeypad({
  disabled = false,
  onValueChange,
  value,
}: NumericKeypadProps) {
  const append = (key: string) => {
    if (key === '.' && value.includes('.')) return;
    onValueChange(`${key === '.' && !value ? '0' : value}${key}`);
  };

  return (
    <div
      aria-label="Цифровая клавиатура"
      className="grid grid-cols-[minmax(0,3fr)_minmax(64px,1fr)] gap-2"
      role="group"
    >
      <div className="grid grid-cols-3 gap-2">
        {keys.map((key) => (
          <Button
            aria-label={key === '.' ? 'Десятичная точка' : undefined}
            className="h-14 border border-border bg-background text-xl font-semibold text-foreground shadow-sm hover:bg-accent"
            disabled={disabled}
            key={key}
            onClick={() => append(key)}
            type="button"
            variant="ghost"
          >
            {key}
          </Button>
        ))}
      </div>
      <div className="grid grid-rows-2 gap-2">
        <Button
          aria-label="Удалить последний символ"
          className="h-full min-h-14 border border-border bg-background text-foreground shadow-sm hover:bg-accent"
          disabled={disabled || !value}
          onClick={() => onValueChange(value.slice(0, -1))}
          type="button"
          variant="ghost"
        >
          <Delete aria-hidden="true" className="size-6" />
        </Button>
        <Button
          aria-label="Очистить"
          className="h-full min-h-14 border border-border bg-background text-foreground shadow-sm hover:bg-accent"
          disabled={disabled || !value}
          onClick={() => onValueChange('')}
          type="button"
          variant="ghost"
        >
          <Eraser aria-hidden="true" className="size-6" />
        </Button>
      </div>
    </div>
  );
}
