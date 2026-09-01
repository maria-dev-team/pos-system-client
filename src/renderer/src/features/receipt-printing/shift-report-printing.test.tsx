import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type FiscalShiftReportResponse,
  getXReport,
} from '@renderer/common/api';

import {
  XReportPrintButton,
  ZReportPrintButton,
} from './shift-report-printing';

vi.mock('@renderer/common/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/common/api')>();
  return { ...actual, getXReport: vi.fn() };
});

const report: FiscalShiftReportResponse = {
  cash: { balance: '720.00', deposited: '0.00', withdrawn: '0.00' },
  cashbox: {
    identity_number: 'IN-1',
    registration_number: 'RN-1',
    serial_number: 'SWK00000001',
  },
  cashier: { code: null, name: 'Айжан' },
  change: '0.00',
  closed_at: null,
  control_sum: 'control',
  discount: '80.00',
  document_count: 1,
  generated_at: '2026-08-31T08:57:06.000Z',
  markup: '0.00',
  ofd: { name: 'ОФД', website: null },
  offline: false,
  opened_at: '2026-08-31T08:30:00.000Z',
  operations: {
    purchase_returns: { amount: '0.00', count: 0 },
    purchases: { amount: '0.00', count: 0 },
    sale_returns: { amount: '0.00', count: 0 },
    sales: { amount: '720.00', count: 1 },
  },
  payments: [{ amount: '720.00', provider_type: 1 }],
  provider: 'WEBKASSA',
  report_number: '10',
  report_type: 'X',
  shift_number: '2',
  taken: '720.00',
  taxpayer: { bin_iin: '000000000000', name: 'Demo' },
  vat: '0.00',
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const renderWithClient = (children: ReactNode) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { mutations: { retry: false } },
        })
      }
    >
      {children}
    </QueryClientProvider>,
  );

describe('shift report printing controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.receiptPrinter = {
      getPrinters: vi.fn(),
      print: vi.fn(),
      printShiftReport: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.receiptPrinter;
  });

  it('requests a fresh X report per completed click and blocks duplicates while pending', async () => {
    const user = userEvent.setup();
    const loading = deferred<FiscalShiftReportResponse>();
    vi.mocked(getXReport)
      .mockReturnValueOnce(loading.promise)
      .mockResolvedValue(report);
    renderWithClient(
      <XReportPrintButton registerShiftId="shift-1" timeZone="Asia/Almaty" />,
    );
    const button = screen.getByRole('button', { name: 'Печать X-отчёта' });

    await user.click(button);
    await user.click(button);

    expect(getXReport).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    loading.resolve(report);
    await waitFor(() => expect(button).toBeEnabled());
    expect(window.receiptPrinter?.printShiftReport).toHaveBeenCalledWith(
      expect.objectContaining({
        paperWidthMm: 58,
        report: expect.objectContaining({
          reportNumber: '10',
          timeZone: 'Asia/Almaty',
        }),
      }),
    );

    await user.click(button);
    await waitFor(() => expect(getXReport).toHaveBeenCalledTimes(2));
  });

  it('retries Z printing from the close response without requesting X', async () => {
    const user = userEvent.setup();
    vi.mocked(window.receiptPrinter!.printShiftReport!)
      .mockResolvedValueOnce({
        code: 'PRINT_FAILED',
        message: 'Принтер недоступен.',
        ok: false,
      })
      .mockResolvedValueOnce({ ok: true });
    renderWithClient(
      <ZReportPrintButton
        report={{
          ...report,
          closed_at: '2026-08-31T09:00:00.000Z',
          report_type: 'Z',
        }}
        timeZone="Asia/Almaty"
      />,
    );
    const button = screen.getByRole('button', { name: 'Печать Z-отчёта' });

    await user.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await waitFor(() =>
      expect(window.receiptPrinter?.printShiftReport).toHaveBeenCalledTimes(2),
    );
    expect(getXReport).not.toHaveBeenCalled();
  });

  it('allows retrying X after the backend request fails', async () => {
    const user = userEvent.setup();
    vi.mocked(getXReport)
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValueOnce(report);
    renderWithClient(
      <XReportPrintButton registerShiftId="shift-1" timeZone="Asia/Almaty" />,
    );
    const button = screen.getByRole('button', { name: 'Печать X-отчёта' });

    await user.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(window.receiptPrinter?.printShiftReport).not.toHaveBeenCalled();

    await user.click(button);
    await waitFor(() =>
      expect(window.receiptPrinter?.printShiftReport).toHaveBeenCalledOnce(),
    );
  });
});
