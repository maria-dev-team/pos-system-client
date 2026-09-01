import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { NumericKeypad } from './numeric-keypad';
import { Button } from './ui/button';
import { VirtualKeyboard } from './virtual-keyboard';

type EditableElement = HTMLInputElement | HTMLTextAreaElement;
type KeyboardMode = 'numeric' | 'text';

const isEditableElement = (
  target: EventTarget | null,
): target is EditableElement => {
  if (target instanceof HTMLTextAreaElement) {
    return !target.disabled && !target.readOnly;
  }
  if (
    !(target instanceof HTMLInputElement) ||
    target.disabled ||
    target.readOnly
  ) {
    return false;
  }

  return ![
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'radio',
    'range',
    'reset',
    'submit',
  ].includes(target.type);
};

const getKeyboardMode = (element: EditableElement): KeyboardMode =>
  element instanceof HTMLInputElement &&
  (element.inputMode === 'decimal' ||
    element.inputMode === 'numeric' ||
    element.type === 'number')
    ? 'numeric'
    : 'text';

const setNativeValue = (element: EditableElement, value: string) => {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};

export function OnScreenKeyboardProvider({
  children,
}: {
  children: ReactNode;
}) {
  const activeElementRef = useRef<EditableElement | null>(null);
  const [mode, setMode] = useState<KeyboardMode>('text');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [maxLength, setMaxLength] = useState<number>();

  useEffect(() => {
    const dismiss = () => {
      activeElementRef.current = null;
      setOpen(false);
    };
    const isKeyboardTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(target.closest('[data-on-screen-keyboard]'));
    const activate = (element: EditableElement) => {
      if (element.hasAttribute('data-keyboard-inline')) {
        dismiss();
        return;
      }
      activeElementRef.current = element;
      setMode(getKeyboardMode(element));
      setValue(element.value);
      setMaxLength(element.maxLength > -1 ? element.maxLength : undefined);
      setOpen(true);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (isKeyboardTarget(event.target)) return;
      if (isEditableElement(event.target)) {
        activate(event.target);
        return;
      }
      if (event.target instanceof Element) {
        const label = event.target.closest('label');
        if (label && isEditableElement(label.control)) {
          activate(label.control);
          return;
        }
      }
      dismiss();
    };
    const handleFocus = (event: FocusEvent) => {
      if (isKeyboardTarget(event.target)) return;
      if (!isEditableElement(event.target)) {
        dismiss();
        return;
      }
      activate(event.target);
    };
    const handleInput = (event: Event) => {
      const element = activeElementRef.current;
      if (event.target === element && element) {
        setValue(element.value);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Enter' &&
        event.target === activeElementRef.current &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        dismiss();
        return;
      }
      if (event.key !== 'Escape') return;
      activeElementRef.current = null;
      setOpen((current) => {
        if (!current) return current;
        event.preventDefault();
        event.stopImmediatePropagation();
        return false;
      });
    };
    const handleSubmit = () => dismiss();
    const handleVisibilityChange = () => {
      if (document.hidden) dismiss();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('focusin', handleFocus, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('submit', handleSubmit, true);
    document.addEventListener('visibilitychange', handleVisibilityChange, true);
    window.addEventListener('blur', dismiss);
    if (isEditableElement(document.activeElement)) {
      activate(document.activeElement);
    }
    const observer = new MutationObserver(() => {
      const element = activeElementRef.current;
      if (element && !document.contains(element)) {
        activeElementRef.current = null;
        setOpen(false);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('focusin', handleFocus, true);
      document.removeEventListener('input', handleInput, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('submit', handleSubmit, true);
      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange,
        true,
      );
      window.removeEventListener('blur', dismiss);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    document.body.dataset.onScreenKeyboardOpen = String(open);
    return () => {
      delete document.body.dataset.onScreenKeyboardOpen;
    };
  }, [open]);

  const updateValue = (nextValue: string) => {
    const element = activeElementRef.current;
    if (
      !element ||
      !document.contains(element) ||
      element.disabled ||
      element.readOnly
    ) {
      activeElementRef.current = null;
      setOpen(false);
      return;
    }
    const limitedValue = maxLength ? nextValue.slice(0, maxLength) : nextValue;
    setNativeValue(element, limitedValue);
    setValue(limitedValue);
    element.focus({ preventScroll: true });
  };
  const close = () => {
    activeElementRef.current = null;
    setOpen(false);
  };
  const enter = () => {
    const element = activeElementRef.current;
    if (!element) return;
    if (element instanceof HTMLTextAreaElement) {
      updateValue(`${value}\n`);
      return;
    }
    const shouldSubmit = element.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: 'Enter',
        key: 'Enter',
      }),
    );
    if (shouldSubmit) element.form?.requestSubmit();
    close();
  };

  return (
    <>
      {children}
      {open
        ? createPortal(
            <section
              aria-label={
                mode === 'numeric'
                  ? 'Экранная цифровая клавиатура'
                  : 'Экранная клавиатура'
              }
              className={`pointer-events-auto fixed z-[100] max-h-[58svh] overflow-y-auto border border-border bg-card/98 p-3 shadow-[0_-20px_70px_rgba(15,23,42,0.24)] backdrop-blur sm:p-4 ${mode === 'numeric' ? 'bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 w-[min(28rem,calc(100%-2rem))] rounded-2xl' : 'inset-x-0 bottom-0 rounded-t-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-[max(1rem,env(safe-area-inset-bottom))]'}`}
              data-on-screen-keyboard
              onPointerDown={(event) => event.preventDefault()}
              role="dialog"
              style={{ pointerEvents: 'auto' }}
            >
              <div
                className={`mx-auto w-full ${mode === 'numeric' ? 'max-w-md' : 'max-w-6xl'}`}
              >
                <header className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {mode === 'numeric'
                      ? 'Цифровая клавиатура'
                      : 'Клавиатура · RU / EN'}
                  </p>
                  <Button
                    aria-label="Закрыть экранную клавиатуру"
                    className="size-9"
                    onClick={close}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </header>
                {mode === 'numeric' ? (
                  <NumericKeypad
                    onEnter={enter}
                    onValueChange={updateValue}
                    value={value}
                  />
                ) : (
                  <VirtualKeyboard
                    compact
                    maxLength={maxLength}
                    onEnter={enter}
                    onValueChange={updateValue}
                    value={value}
                  />
                )}
              </div>
            </section>,
            document.body,
          )
        : null}
    </>
  );
}
