import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppUpdateState } from '../../../../main/app-updater';
import { StatusBarUpdateBadges } from './status-bar-update-badges';

const updateState = (
  overrides: Partial<AppUpdateState> = {},
): AppUpdateState => ({
  attempt: 1,
  availableVersion: null,
  currentVersion: '1.2.3',
  downloadPercent: null,
  restartAt: null,
  status: 'current',
  ...overrides,
});

afterEach(cleanup);

describe('StatusBarUpdateBadges', () => {
  it('shows the current version without a state label', () => {
    render(<StatusBarUpdateBadges state={updateState()} />);

    expect(screen.getByText('v1.2.3')).toBeInTheDocument();
    expect(screen.queryByText('Не проверена')).not.toBeInTheDocument();
    expect(screen.queryByText('Устаревшая')).not.toBeInTheDocument();
  });

  it('shows an amber unchecked state badge', () => {
    render(
      <StatusBarUpdateBadges state={updateState({ status: 'unchecked' })} />,
    );

    expect(screen.getByText('v1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Не проверена')).toHaveClass(
      'bg-amber-50',
      'text-amber-700',
      'dark:bg-amber-950',
      'dark:text-amber-300',
    );
  });

  it('shows the requested outdated state palette', () => {
    render(
      <StatusBarUpdateBadges state={updateState({ status: 'outdated' })} />,
    );

    expect(screen.getByText('v1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Устаревшая')).toHaveClass(
      'bg-red-50',
      'text-red-700',
      'dark:bg-red-950',
      'dark:text-red-300',
    );
  });
});
