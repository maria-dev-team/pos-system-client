import { useEffect, useMemo, useRef } from 'react';
import Keyboard, {
  type KeyboardButtonAttributes,
  type SimpleKeyboard,
} from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

type VirtualKeyboardProps = {
  compact?: boolean;
  disabled?: boolean;
  maxLength?: number;
  onClose?: () => void;
  onValueChange: (value: string) => void;
  value: string;
};

const textRows = [
  'ё 1 2 3 4 5 6 7 8 9 0 {bksp}',
  'й ц у к е н г ш щ з х ъ',
  'ф ы в а п р о л д ж э',
  'я ч с м и т ь б ю',
];

export function VirtualKeyboard({
  compact = false,
  disabled = false,
  maxLength,
  onClose,
  onValueChange,
  value,
}: VirtualKeyboardProps) {
  const keyboardRef = useRef<SimpleKeyboard | null>(null);
  const layout = useMemo(
    () => ({
      default: [...textRows, `{clear} {space}${onClose ? ' {close}' : ''}`],
    }),
    [onClose],
  );
  const allButtons = layout.default.join(' ');
  const buttonAttributes: KeyboardButtonAttributes[] = [
    { attribute: 'type', buttons: allButtons, value: 'button' },
    {
      attribute: 'aria-label',
      buttons: '{bksp}',
      value: 'Удалить последний символ',
    },
    { attribute: 'aria-label', buttons: '{clear}', value: 'Очистить' },
    { attribute: 'aria-label', buttons: '{space}', value: 'Пробел' },
    ...(onClose
      ? [
          {
            attribute: 'aria-label',
            buttons: '{close}',
            value: 'Закрыть',
          },
        ]
      : []),
    ...(disabled
      ? [{ attribute: 'disabled', buttons: allButtons, value: 'true' }]
      : []),
  ];

  useEffect(() => {
    keyboardRef.current?.setInput(value);
  }, [value]);

  return (
    <div
      aria-disabled={disabled || undefined}
      aria-label="Виртуальная клавиатура"
      role="group"
    >
      <Keyboard
        buttonAttributes={buttonAttributes}
        disableCaretPositioning
        display={{
          '{bksp}': '⌫',
          '{clear}': 'Очистить',
          '{close}': 'Закрыть',
          '{space}': 'Пробел',
        }}
        keyboardRef={(instance) => {
          keyboardRef.current = instance;
          instance.setInput(value);
        }}
        layout={layout}
        maxLength={maxLength}
        mergeDisplay
        onChange={(nextValue) => {
          if (!disabled) onValueChange(nextValue);
        }}
        onKeyPress={(button) => {
          if (disabled) return;
          if (button === '{clear}') {
            keyboardRef.current?.clearInput();
            onValueChange('');
          }
          if (button === '{close}') onClose?.();
        }}
        preventMouseDownDefault
        theme={`hg-theme-default maria-virtual-keyboard maria-virtual-keyboard--text${compact ? ' maria-virtual-keyboard--compact' : ''}`}
        useButtonTag
      />
    </div>
  );
}

export function VirtualKeyboardOverlay({
  open,
  onOpenChange,
  ...keyboardProps
}: VirtualKeyboardProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="bottom-0 left-0 top-auto max-h-[50svh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-b-none border-x-0 border-b-0 p-4 sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Экранная клавиатура</DialogTitle>
        </DialogHeader>
        <VirtualKeyboard
          {...keyboardProps}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
