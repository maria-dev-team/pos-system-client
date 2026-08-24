import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMinuteClock } from './use-minute-clock';

afterEach(() => {
  vi.useRealTimers();
});

describe('useMinuteClock', () => {
  it('updates at the start of the next minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T10:00:30.000Z'));

    const { result } = renderHook(() => useMinuteClock());

    act(() => vi.advanceTimersByTime(30_000));

    expect(result.current).toEqual(new Date('2026-08-24T10:01:00.000Z'));
  });
});
