import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockToastSuccess = vi.fn();

vi.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => mockToastSuccess(...args) },
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement('a', { href, ...props }, children as React.ReactNode),
}));

import ComposeEmailModal from '@/components/ComposeEmailModal';
import type { CRMStatus } from '@/types';

const defaultLead = {
  id: 'lead-1',
  name: 'John Doe',
  email: 'john@example.com',
  crmStatus: 'New' as CRMStatus,
};

const leadNoEmail = {
  id: 'lead-2',
  name: 'No Email Lead',
  crmStatus: 'New' as CRMStatus,
};

function gmailConnected(email = 'user@gmail.com') {
  return vi.fn().mockImplementation((url: string) => {
    if (url === '/api/pipeline/email/status')
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ connected: true, email, provider: 'gmail' }),
      });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

function gmailDisconnected() {
  return vi.fn().mockImplementation((url: string) => {
    if (url === '/api/pipeline/email/status')
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ connected: false }),
      });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

/** Helper to build a fetch mock that returns outreach API success */
function outreachSuccess() {
  return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url === '/api/pipeline/email/status')
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ connected: true, email: 'user@gmail.com', provider: 'gmail' }),
      });
    if (url === '/api/outreach' && opts?.method === 'POST')
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ emailSent: true }),
      });
    // CRM status PATCH
    if (url.includes('/api/crm/') && opts?.method === 'PATCH')
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

/** Helper to build a fetch mock that returns a specific outreach error */
function outreachError(status: number, body: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url === '/api/pipeline/email/status')
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ connected: true, email: 'user@gmail.com', provider: 'gmail' }),
      });
    if (url === '/api/outreach' && opts?.method === 'POST')
      return Promise.resolve({
        ok: false,
        status,
        json: () => Promise.resolve(body),
      });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockToastSuccess.mockClear();
  global.fetch = gmailConnected();
});

describe('ComposeEmailModal', () => {
  // 1. Modal renders To/Subject/Body fields when opened
  it('renders To, Subject, and Body fields when opened', async () => {
    render(<ComposeEmailModal open onOpenChange={vi.fn()} lead={defaultLead} />);

    await waitFor(() => {
      expect(screen.getByLabelText('To')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Subject')).toBeInTheDocument();
    expect(screen.getByLabelText('Body')).toBeInTheDocument();
  });

  // 2. Gmail connected state shows email address with provider
  it('shows connected email address with provider when connected', async () => {
    global.fetch = gmailConnected('connected@gmail.com');
    render(<ComposeEmailModal open onOpenChange={vi.fn()} lead={defaultLead} />);

    await waitFor(() => {
      expect(screen.getByText(/Connected via Gmail: connected@gmail.com/)).toBeInTheDocument();
    });
  });

  // 3. Disconnected state shows warning banner with /autopilot link
  it('shows warning banner with /autopilot link when email is disconnected', async () => {
    global.fetch = gmailDisconnected();
    render(<ComposeEmailModal open onOpenChange={vi.fn()} lead={defaultLead} />);

    await waitFor(() => {
      expect(screen.getByText('Email not connected')).toBeInTheDocument();
    });
    const link = screen.getByText('Connect in Autopilot settings');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/autopilot');
  });

  // 4. No recipient email shows inline alert and disables send
  it('shows inline alert and disables send when lead has no email', async () => {
    render(<ComposeEmailModal open onOpenChange={vi.fn()} lead={leadNoEmail} />);

    await waitFor(() => {
      expect(screen.getByText('This lead has no email address on file.')).toBeInTheDocument();
    });

    const sendBtn = screen.getByRole('button', { name: /send email/i });
    expect(sendBtn).toBeDisabled();
  });

  // 5. To field is read-only
  it('renders the To field as read-only', async () => {
    render(<ComposeEmailModal open onOpenChange={vi.fn()} lead={defaultLead} />);

    await waitFor(() => {
      expect(screen.getByLabelText('To')).toBeInTheDocument();
    });

    const toField = screen.getByLabelText('To');
    expect(toField).toHaveAttribute('readonly');
    expect(toField).toHaveValue('john@example.com');
  });

  // 6. Subject defaults to "Introduction"
  it('defaults Subject to "Introduction"', async () => {
    render(<ComposeEmailModal open onOpenChange={vi.fn()} lead={defaultLead} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Subject')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Subject')).toHaveValue('Introduction');
  });

  // 7. Subject and Body fields are editable
  it('allows editing Subject and Body fields', async () => {
    render(<ComposeEmailModal open onOpenChange={vi.fn()} lead={defaultLead} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Subject')).toBeInTheDocument();
    });

    const subjectInput = screen.getByLabelText('Subject');
    fireEvent.change(subjectInput, { target: { value: 'New Subject' } });
    expect(subjectInput).toHaveValue('New Subject');

    const bodyInput = screen.getByLabelText('Body');
    fireEvent.change(bodyInput, { target: { value: 'Hello there' } });
    expect(bodyInput).toHaveValue('Hello there');
  });

  // 8. Send button labels: "Send Email", "Sending...", disabled states
  it('shows correct send button labels and disabled states', async () => {
    // Start with body empty => disabled
    render(<ComposeEmailModal open onOpenChange={vi.fn()} lead={defaultLead} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send email/i })).toBeInTheDocument();
    });

    const sendBtn = screen.getByRole('button', { name: /send email/i });
    // Body is empty by default, so send is disabled
    expect(sendBtn).toBeDisabled();

    // Fill body to enable
    const bodyInput = screen.getByLabelText('Body');
    fireEvent.change(bodyInput, { target: { value: 'Test message' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send Email' })).toBeEnabled();
    });
  });

  // 9. Cancel button label
  it('renders a Cancel button', async () => {
    render(<ComposeEmailModal open onOpenChange={vi.fn()} lead={defaultLead} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  // 10. Successful send closes modal and calls onSuccess
  it('closes modal and calls onSuccess on successful send', async () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    global.fetch = outreachSuccess();

    render(
      <ComposeEmailModal
        open
        onOpenChange={onOpenChange}
        lead={defaultLead}
        prefillBody="Hello!"
        onSuccess={onSuccess}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send Email' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send Email' }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  // 11. Toast notification on success with recipient and subject
  it('shows toast with recipient and subject on success', async () => {
    global.fetch = outreachSuccess();

    render(
      <ComposeEmailModal
        open
        onOpenChange={vi.fn()}
        lead={defaultLead}
        prefillBody="Message body"
        onSuccess={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send Email' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send Email' }));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalled();
    });

    const toastMessage = mockToastSuccess.mock.calls[0][0] as string;
    expect(toastMessage).toContain('john@example.com');
    expect(toastMessage).toContain('Introduction');
  });

  // 12. Each error type renders correct Failure_Alert message
  describe('error types render correct Failure_Alert messages', () => {
    it('shows EMAIL_NOT_CONNECTED error message', async () => {
      global.fetch = outreachError(400, {
        error: 'email_error',
        message: 'Gmail not connected',
        details: { email: 'not_connected' },
      });

      render(
        <ComposeEmailModal open onOpenChange={vi.fn()} lead={defaultLead} prefillBody="body" />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Send Email' })).toBeEnabled();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Send Email' }));

      await waitFor(() => {
        expect(screen.getByText('Send Failed')).toBeInTheDocument();
      });
      expect(screen.getByText(/Email is not connected/i)).toBeInTheDocument();
    });

    it('shows EMAIL_MISSING error message', async () => {
      global.fetch = outreachError(400, {
        error: 'email_error',
        message: 'No email',
        details: { email: 'missing' },
      });

      render(
        <ComposeEmailModal open onOpenChange={vi.fn()} lead={defaultLead} prefillBody="body" />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Send Email' })).toBeEnabled();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Send Email' }));

      await waitFor(() => {
        expect(screen.getByText('Send Failed')).toBeInTheDocument();
      });
      expect(screen.getByText('This lead has no email address.')).toBeInTheDocument();
    });

    it('shows THROTTLE_LIMIT error message with limit', async () => {
      global.fetch = outreachError(429, {
        error: 'throttle_error',
        message: 'Rate limited',
        details: { limit: '50', used: '50' },
      });

      render(
        <ComposeEmailModal open onOpenChange={vi.fn()} lead={defaultLead} prefillBody="body" />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Send Email' })).toBeEnabled();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Send Email' }));

      await waitFor(() => {
        expect(screen.getByText('Send Failed')).toBeInTheDocument();
      });
      expect(screen.getByText(/Daily email limit reached \(50\)/)).toBeInTheDocument();
    });

    it('shows GENERIC_ERROR with API message', async () => {
      global.fetch = outreachError(500, {
        error: 'server_error',
        message: 'Internal server error occurred',
      });

      render(
        <ComposeEmailModal open onOpenChange={vi.fn()} lead={defaultLead} prefillBody="body" />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Send Email' })).toBeEnabled();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Send Email' }));

      await waitFor(() => {
        expect(screen.getByText('Send Failed')).toBeInTheDocument();
      });
      expect(screen.getByText('Internal server error occurred')).toBeInTheDocument();
    });
  });

  // 13. Modal stays open on error
  it('keeps modal open on error', async () => {
    const onOpenChange = vi.fn();
    global.fetch = outreachError(500, {
      error: 'server_error',
      message: 'Something went wrong',
    });

    render(
      <ComposeEmailModal open onOpenChange={onOpenChange} lead={defaultLead} prefillBody="body" />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send Email' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send Email' }));

    await waitFor(() => {
      expect(screen.getByText('Send Failed')).toBeInTheDocument();
    });

    // Modal should NOT have been closed
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Form fields should still be visible
    expect(screen.getByLabelText('Subject')).toBeInTheDocument();
    expect(screen.getByLabelText('Body')).toBeInTheDocument();
  });
});
