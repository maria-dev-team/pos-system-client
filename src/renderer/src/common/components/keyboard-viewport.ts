import { type RefObject, useLayoutEffect, useRef } from 'react';

type EditableElement = HTMLInputElement | HTMLTextAreaElement;

export function useKeyboardViewport(
  open: boolean,
  layout: string,
  keyboardRef: RefObject<HTMLElement | null>,
  activeElementRef: RefObject<EditableElement | null>,
) {
  const revealRef = useRef(() => {});

  useLayoutEffect(() => {
    document.body.dataset.onScreenKeyboardOpen = String(open);
    const keyboard = keyboardRef.current;
    let frame = 0;
    const clear = () => {
      cancelAnimationFrame(frame);
      revealRef.current = () => {};
      document.documentElement.style.removeProperty('--pos-viewport-height');
      delete document.body.dataset.onScreenKeyboardOpen;
    };
    if (!open || !keyboard) return clear;

    const reveal = () => {
      const element = activeElementRef.current;
      if (!element?.isConnected) return;
      const bounds = element.getBoundingClientRect();
      let top = 0;
      let bottom = keyboard.getBoundingClientRect().top;
      // Nested scroll containers (including dialogs) can clip a field even
      // when it is above the keyboard itself.
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (
          /(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)
        ) {
          const parentBounds = parent.getBoundingClientRect();
          top = Math.max(top, parentBounds.top);
          bottom = Math.min(bottom, parentBounds.bottom);
        }
      }
      if (bounds.top < top + 16 || bounds.bottom > bottom - 16) {
        element.scrollIntoView?.({
          block: 'nearest',
          inline: 'nearest',
          behavior: 'instant',
        });
      }
    };
    const scheduleReveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    };
    revealRef.current = scheduleReveal;
    const measure = () => {
      const bounds = keyboard.getBoundingClientRect();
      if (!bounds.height) return;
      document.documentElement.style.setProperty(
        '--pos-viewport-height',
        `${Math.max(0, Math.min(window.innerHeight, bounds.top))}px`,
      );
      scheduleReveal();
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(keyboard);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      clear();
    };
  }, [open, layout, keyboardRef, activeElementRef]);

  return revealRef;
}
