import { useEffect, useMemo, useRef, useState } from 'react';
import Keyboard, {
  type KeyboardButtonAttributes,
  type SimpleKeyboard,
} from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';

type VirtualKeyboardProps = {
  compact?: boolean;
  disabled?: boolean;
  maxLength?: number;
  onClose?: () => void;
  onEnter?: () => void;
  onValueChange: (value: string) => void;
  value: string;
};

const russianRows = [
  'ё 1 2 3 4 5 6 7 8 9 0 {bksp}',
  'й ц у к е н г ш щ з х ъ',
  'ф ы в а п р о л д ж э',
  '{shift} я ч с м и т ь б ю . ,',
];
const russianShiftRows = [
  'Ё 1 2 3 4 5 6 7 8 9 0 {bksp}',
  'Й Ц У К Е Н Г Ш Щ З Х Ъ',
  'Ф Ы В А П Р О Л Д Ж Э',
  '{shift} Я Ч С М И Т Ь Б Ю . ,',
];
const englishRows = [
  '` 1 2 3 4 5 6 7 8 9 0 {bksp}',
  'q w e r t y u i o p',
  'a s d f g h j k l',
  '{shift} z x c v b n m . ,',
];
const englishShiftRows = [
  '~ 1 2 3 4 5 6 7 8 9 0 {bksp}',
  'Q W E R T Y U I O P',
  'A S D F G H J K L',
  '{shift} Z X C V B N M . ,',
];

export function VirtualKeyboard({
  compact = false,
  disabled = false,
  maxLength,
  onClose,
  onEnter,
  onValueChange,
  value,
}: VirtualKeyboardProps) {
  const keyboardRef = useRef<SimpleKeyboard | null>(null);
  const [language, setLanguage] = useState<'en' | 'ru'>('ru');
  const [shifted, setShifted] = useState(false);
  const rows =
    language === 'ru'
      ? shifted
        ? russianShiftRows
        : russianRows
      : shifted
        ? englishShiftRows
        : englishRows;
  const layout = useMemo(
    () => ({
      default: [
        ...rows,
        `{lang} @ - _ {space} {enter} {clear}${onClose ? ' {close}' : ''}`,
      ],
    }),
    [onClose, rows],
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
    { attribute: 'aria-label', buttons: '{enter}', value: 'Ввод' },
    {
      attribute: 'aria-label',
      buttons: '{lang}',
      value:
        language === 'ru'
          ? 'Переключить на английский'
          : 'Переключить на русский',
    },
    {
      attribute: 'aria-label',
      buttons: '{shift}',
      value: shifted ? 'Строчные буквы' : 'Заглавные буквы',
    },
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
          '{enter}': 'Ввод',
          '{lang}': language.toUpperCase(),
          '{shift}': shifted ? 'aа' : 'AА',
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
          if (button === '{enter}') onEnter?.();
          if (button === '{lang}') {
            setLanguage((current) => (current === 'ru' ? 'en' : 'ru'));
            setShifted(false);
          }
          if (button === '{shift}') setShifted((current) => !current);
        }}
        preventMouseDownDefault
        theme={`hg-theme-default maria-virtual-keyboard maria-virtual-keyboard--text${compact ? ' maria-virtual-keyboard--compact' : ''}`}
        useButtonTag
      />
    </div>
  );
}
