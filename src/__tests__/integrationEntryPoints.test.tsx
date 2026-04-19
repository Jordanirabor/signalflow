import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ---

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) =>
    React.createElement('a', { href, ...props }, children as React.ReactNode),
}));

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    session: { id: 'test', founderId: 'f1', name: 'Test', email: 'test@test.com' },
    isLoading: false,
  }),
}));

import LeadDetailView from '@/components/LeadDetailView';
import OutreachTracker from '@/components/OutreachTracker';

// --- Test data ---

const leadData = {
  id: 'lead-1',
  name: 'John Doe',
  email: 'john@example.com',
  role: 'CTO',
  company: 'Acme',
  industry: 'Tech',
  geography: 'US',
  crmStatus: 'New',
  leadScore: 80,
  scoreBreakdown: { icpMatch: 30, roleRelevance: 25, intentSignals: 25 },
  enrichmentStatus: 'complete',
  isDeleted: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
function createFetchMock(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : String(url);

    // Lead detail
    if (
      urlStr.match(/\/api\/leads\/[^/]+$/) &&
      (!opts || opts.method === undefined || opts.method === 'GET')
    ) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides['lead'] ?? leadData),
      });
    }

    // Outreach history
    if (urlStr.match(/\/api\/outreach\/[^/]+$/)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides['outreach'] ?? []),
      });
    }

    // Insights / call notes
    if (urlStr.match(/\/api\/insights\/[^/]+$/)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides['insights'] ?? []),
      });
    }

    // Research profile
    if (urlStr.match(/\/api\/leads\/[^/]+\/research$/)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides['research'] ?? null),
      });
    }

    // Correlation
    if (urlStr.match(/\/api\/leads\/[^/]+\/correlation$/)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(overrides['correlation'] ?? null),
      });
    }

    // Email status
    if (urlStr.includes('/api/pipeline/email/status')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(overrides['emailStatus'] ?? { connected: true, email: 'user@gmail.com' }),
      });
    }

    // Pipeline config
    if (urlStr.includes('/api/pipeline/config')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            overrides['pipelineConfig'] ?? { productContext: 'test', valueProposition: 'test' },
          ),
      });
    }

    // Message generation
    if (urlStr.includes('/api/messages/generate') && opts?.method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            overrides['messageGenerate'] ?? {
              message: 'Generated message content',
              personalizationDetails: [],
            },
          ),
      });
    }

    // Throttle status
    if (urlStr.includes('/api/throttle/status')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            overrides['throttleStatus'] ?? {
              email: {
                used: 0,
                limit: 20,
                remaining: 20,
                warningThreshold: false,
                channel: 'email',
              },
              dm: { used: 0, limit: 20, remaining: 20, warningThreshold: false, channel: 'dm' },
            },
          ),
      });
    }

    // Auth session
    if (urlStr.includes('/api/auth/session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            authenticated: true,
            founderId: 'f1',
            name: 'Test User',
            email: 'test@test.com',
          }),
      });
    }

    // Default
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = createFetchMock();
});
// --- LeadDetailView Tests ---

describe('LeadDetailView integration entry points', () => {
  it('renders a "Compose Email" button', async () => {
    render(<LeadDetailView leadId="lead-1" onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Compose Email' })).toBeInTheDocument();
    });
  });

  it('renders "Send Email" button after message generation', async () => {
    render(<LeadDetailView leadId="lead-1" onBack={vi.fn()} />);

    // Wait for the component to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generate Message' })).toBeInTheDocument();
    });

    // Click Generate Message
    fireEvent.click(screen.getByRole('button', { name: 'Generate Message' }));

    // Wait for generated message to appear and "Send Email" button to render
    await waitFor(() => {
      expect(screen.getByText('Generated message content')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Send Email' })).toBeInTheDocument();
  });

  it('does not render "Send & Move to Contacted" text', async () => {
    render(<LeadDetailView leadId="lead-1" onBack={vi.fn()} />);

    // Wait for component to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Compose Email' })).toBeInTheDocument();
    });

    // Verify the old button label is not present
    expect(screen.queryByText(/Send & Move to Contacted/i)).not.toBeInTheDocument();

    // Also verify after message generation
    fireEvent.click(screen.getByRole('button', { name: 'Generate Message' }));

    await waitFor(() => {
      expect(screen.getByText('Generated message content')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Send & Move to Contacted/i)).not.toBeInTheDocument();
  });
});

// --- OutreachTracker Tests ---

describe('OutreachTracker integration entry points', () => {
  it('renders "Compose Email" button instead of "Send Email" for email channel', async () => {
    render(
      <OutreachTracker
        leadId="lead-1"
        lead={{ id: 'lead-1', name: 'John Doe', email: 'john@example.com', crmStatus: 'New' }}
      />,
    );

    // Wait for session loading to complete and component to render
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Compose Email' })).toBeInTheDocument();
    });

    // Ensure "Send Email" is NOT present when email channel is selected (default)
    expect(screen.queryByRole('button', { name: 'Send Email' })).not.toBeInTheDocument();
  });
});
