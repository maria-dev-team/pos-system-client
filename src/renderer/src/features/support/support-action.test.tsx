import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SupportAction } from './support-action';

const { sendSupportMessageMock, toastSuccessMock } = vi.hoisted(() => ({
  sendSupportMessageMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('@renderer/common/api', () => ({
  sendSupportMessage: sendSupportMessageMock,
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock },
}));

const renderAction = () => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SupportAction />
    </QueryClientProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SupportAction', () => {
  it('opens from the status action and sends a trimmed message', async () => {
    sendSupportMessageMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderAction();

    await user.click(
      screen.getByRole('button', { name: 'Техническая поддержка' }),
    );

    const message = screen.getByLabelText('Сообщение');
    expect(message).toHaveAttribute('maxLength', '6000');
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();

    await user.type(message, '  Не закрывается смена  ');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() => {
      expect(sendSupportMessageMock.mock.calls[0]?.[0]).toEqual({
        message: 'Не закрывается смена',
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Техническая поддержка' }),
      ).not.toBeInTheDocument();
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'Сообщение отправлено в службу поддержки',
    );
  });

  it('keeps the dialog open and shows a retryable error', async () => {
    sendSupportMessageMock.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderAction();

    await user.click(
      screen.getByRole('button', { name: 'Техническая поддержка' }),
    );
    await user.type(screen.getByLabelText('Сообщение'), 'Нужна помощь');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));

    expect(
      await screen.findByText(
        'Не удалось отправить сообщение. Повторите попытку.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: 'Техническая поддержка' }),
    ).toBeInTheDocument();
  });
});
