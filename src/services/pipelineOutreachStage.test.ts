import { vi } from 'vitest';

// Mock all external dependencies before importing the module under test
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  default: {},
}));
vi.mock('@/services/pipelineConfigService', () => ({
  getPipelineConfig: vi.fn(),
}));
vi.mock('@/services/icpService', () => ({
  getEnrichedICP: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/icpProfileService', () => ({
  getActiveProfiles: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/scoringService', () => ({
  calculateLeadScoreV2: vi.fn(),
}));
vi.mock('@/services/discovery/discoveryEngine', () => ({
  discoverLeadsMultiICP: vi.fn().mockResolvedValue({ prospects: [], profileResults: new Map() }),
}));
vi.mock('@/services/leadService', () => ({
  createLead: vi.fn(),
  findDuplicate: vi.fn(),
  updateLeadEnrichment: vi.fn(),
}));
vi.mock('@/services/crmService', () => ({
  changeLeadStatus: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/emailIntegrationService', () => ({
  sendEmail: vi.fn(),
  getEmailConnection: vi.fn().mockResolvedValue(null),
  pollInbox: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/responseClassifierService', () => ({
  classifyReply: vi.fn(),
}));
vi.mock('@/services/bookingAgentService', () => ({
  proposeSlots: vi.fn().mockResolvedValue(null),
  handleProposalExpiry: vi.fn().mockResolvedValue(null),
  handleDecline: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/messageService', () => ({
  generateMessage: vi.fn(),
  generateMessageWithResearchFallback: vi.fn(),
}));
vi.mock('@/services/outreachService', () => ({
  getOutreachHistory: vi.fn().mockResolvedValue([]),
  recordOutreach: vi.fn(),
}));
vi.mock('@/services/qualityGateService', () => ({
  runAllChecks: vi.fn(),
}));
vi.mock('@/services/strategyService', () => ({
  extractStrategy: vi.fn().mockReturnValue({
    productContext: 'Our SaaS product',
    valueProposition: 'Save time',
    targetPainPoints: ['manual work'],
    tonePreference: 'professional',
  }),
  formatStrategyForPrompt: vi.fn().mockReturnValue('Product Context: Our SaaS product'),
}));
vi.mock('@/services/throttleService', () => ({
  canRecordOutreach: vi.fn(),
}));

vi.mock('@/services/correlationEngineService', () => ({
  scoreAndStoreCorrelation: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/prospectResearcherService', () => ({
  getResearchProfile: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/discovery/discoveryLogger', () => ({
  logStructured: vi.fn(),
  logPipelineRunSummary: vi.fn(),
  logDiscoverySummary: vi.fn(),
  logEnrichmentSummary: vi.fn(),
}));
vi.mock('@/services/discovery/enrichmentPipeline', () => ({
  enrichProspect: vi.fn().mockResolvedValue({ enrichmentData: {}, enrichmentStatus: 'pending' }),
  mergeEnrichmentWithExisting: vi
    .fn()
    .mockImplementation((existing, newData) => ({ ...existing, ...newData })),
}));
vi.mock('@/services/discovery/runCache', () => ({
  createRunCache: vi.fn().mockReturnValue({}),
}));
vi.mock('@/services/enrichmentService', () => ({
  enrichLead: vi.fn().mockResolvedValue({ enrichmentData: {}, enrichmentStatus: 'complete' }),
}));

import { query } from '@/lib/db';
import { changeLeadStatus } from '@/services/crmService';
import { sendEmail } from '@/services/emailIntegrationService';
import { generateMessage, generateMessageWithResearchFallback } from '@/services/messageService';
import { recordOutreach } from '@/services/outreachService';
import { getPipelineConfig } from '@/services/pipelineConfigService';
import { runAllChecks } from '@/services/qualityGateService';
import { canRecordOutreach } from '@/services/throttleService';
import { executePipelineRun, generateStaggerDelay } from './pipelineOrchestratorService';

const mockedQuery = vi.mocked(query);
const mockedGetPipelineConfig = vi.mocked(getPipelineConfig);
const mockedCanRecordOutreach = vi.mocked(canRecordOutreach);
const mockedGenerateMessage = vi.mocked(generateMessage);
const mockedGenerateMessageWithResearchFallback = vi.mocked(generateMessageWithResearchFallback);
const mockedRunAllChecks = vi.mocked(runAllChecks);
const mockedSendEmail = vi.mocked(sendEmail);
const mockedRecordOutreach = vi.mocked(recordOutreach);
const mockedChangeLeadStatus = vi.mocked(changeLeadStatus);

const FOUNDER_ID = 'f-1';
const PROJECT_ID = 'proj-1';

const defaultConfig = {
  founderId: FOUNDER_ID,
  runIntervalMinutes: 60,
  businessHoursStart: '09:00',
  businessHoursEnd: '17:00',
  businessDays: [1, 2, 3, 4, 5],
  timezone: 'America/New_York',
  dailyDiscoveryCap: 50,
  minLeadScore: 50,
  maxFollowUps: 3,
  sequenceCadenceDays: [3, 5, 7],
  tonePreference: 'professional' as const,
  productContext: 'Our SaaS product',
  valueProposition: 'Save time',
  targetPainPoints: ['manual work'],
};

function dbResult(rows: unknown[] = []) {
  return { rows, command: '', rowCount: rows.length, oid: 0, fields: [] };
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    founder_id: FOUNDER_ID,
    project_id: PROJECT_ID,
    status: 'completed',
    stages_completed: [
      'enrichment_retry',
      'discovery',
      'outreach',
      'follow_up',
      'inbox',
      'booking',
    ],
    stage_errors: {},
    prospects_discovered: 0,
    messages_sent: 0,
    replies_processed: 0,
    meetings_booked: 0,
    enrichments_retried: 0,
    started_at: new Date(),
    completed_at: new Date(),
    ...overrides,
  };
}

/**
 * Helper: prepend the standard stale-run-check + INSERT + enrichment_retry + discovery queries
 * that executePipelineRun now issues before reaching the outreach stage.
 */
function prependPipelineSetupMocks() {
  mockedQuery
    .mockResolvedValueOnce(dbResult([])) // SELECT stale runs (none)
    .mockResolvedValueOnce(dbResult([runRow({ status: 'running' })])) // INSERT pipeline_run
    .mockResolvedValueOnce(dbResult([])) // enrichment_retry: SELECT leads (none eligible)
    .mockResolvedValueOnce(dbResult([{ count: '0' }])); // discovery: SELECT count (daily cap) — no profiles so 0 discovered
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetPipelineConfig.mockResolvedValue(defaultConfig);
});

describe('generateStaggerDelay', () => {
  it('returns a value between 30 and 120 inclusive', () => {
    for (let i = 0; i < 100; i++) {
      const delay = generateStaggerDelay();
      expect(delay).toBeGreaterThanOrEqual(30);
      expect(delay).toBeLessThanOrEqual(120);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });
});

describe('executeOutreachStage (via executePipelineRun)', () => {
  it('sends outreach to qualifying leads and updates CRM status', async () => {
    const leadRow = {
      id: 'lead-1',
      name: 'Jane Doe',
      role: 'CTO',
      company: 'Acme',
      industry: 'SaaS',
      email: 'jane@acme.com',
      lead_score: 75,
      enrichment_data: { linkedinBio: 'Tech leader' },
    };

    mockedCanRecordOutreach.mockResolvedValue(true);
    mockedGenerateMessageWithResearchFallback.mockResolvedValue({
      message: 'Hi Jane, great work at Acme. Tech leader',
      personalizationDetails: ['LinkedIn bio: Tech leader'],
      limitedPersonalization: false,
    });
    mockedRunAllChecks.mockReturnValue({ passed: true, failures: [] });
    mockedSendEmail.mockResolvedValue({
      gmailThreadId: 'thread-1',
      gmailMessageId: 'msg-1',
    });
    mockedRecordOutreach.mockResolvedValue({
      id: 'or-1',
      leadId: 'lead-1',
      founderId: FOUNDER_ID,
      channel: 'email',
      messageContent: 'Hi Jane',
      outreachDate: new Date(),
      isFollowUp: false,
      createdAt: new Date(),
    });

    mockedQuery
      .mockResolvedValueOnce(dbResult([])) // SELECT stale runs (none)
      .mockResolvedValueOnce(dbResult([runRow({ status: 'running' })])) // INSERT pipeline_run
      .mockResolvedValueOnce(dbResult([])) // enrichment_retry: SELECT leads (none eligible)
      // discovery: getActiveProfiles returns [] so no DB queries
      .mockResolvedValueOnce(dbResult([leadRow])) // outreach: SELECT leads
      .mockResolvedValueOnce(dbResult([])) // outreach: UPDATE outreach_record gmail ids
      .mockResolvedValueOnce(dbResult([])) // follow_up: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT replied leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT expired proposals (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT decline proposals (empty)
      .mockResolvedValueOnce(dbResult([{ count: '0' }])) // booking: SELECT COUNT confirmed
      .mockResolvedValueOnce(dbResult([runRow({ messages_sent: 1 })])); // UPDATE pipeline_run

    const result = await executePipelineRun(FOUNDER_ID, PROJECT_ID);

    expect(mockedGenerateMessageWithResearchFallback).toHaveBeenCalledTimes(1);
    expect(mockedRunAllChecks).toHaveBeenCalledTimes(1);
    expect(mockedSendEmail).toHaveBeenCalledWith(
      FOUNDER_ID,
      'jane@acme.com',
      expect.any(String),
      expect.any(String),
    );
    expect(mockedRecordOutreach).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-1',
        founderId: FOUNDER_ID,
        channel: 'email',
        isFollowUp: false,
      }),
    );
    expect(mockedChangeLeadStatus).toHaveBeenCalledWith({
      leadId: 'lead-1',
      toStatus: 'Contacted',
    });
    expect(result.messagesSent).toBe(1);
  });

  it('skips leads when quality gate rejects', async () => {
    const leadRow = {
      id: 'lead-2',
      name: 'Bob',
      role: 'VP',
      company: 'Corp',
      industry: 'Finance',
      email: 'bob@corp.com',
      lead_score: 60,
      enrichment_data: null,
    };

    mockedCanRecordOutreach.mockResolvedValue(true);
    mockedGenerateMessageWithResearchFallback.mockResolvedValue({
      message: 'Generic message',
      personalizationDetails: [],
      limitedPersonalization: true,
    });
    mockedRunAllChecks.mockReturnValue({
      passed: false,
      failures: [{ check: 'personalization', reason: 'No personalization' }],
    });

    mockedQuery
      .mockResolvedValueOnce(dbResult([])) // SELECT stale runs (none)
      .mockResolvedValueOnce(dbResult([runRow({ status: 'running' })])) // INSERT pipeline_run
      .mockResolvedValueOnce(dbResult([])) // enrichment_retry: SELECT leads (none eligible)
      // discovery: getActiveProfiles returns [] so no DB queries
      .mockResolvedValueOnce(dbResult([leadRow])) // outreach: SELECT leads
      .mockResolvedValueOnce(dbResult([])) // follow_up: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT replied leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT expired proposals (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT decline proposals (empty)
      .mockResolvedValueOnce(dbResult([{ count: '0' }])) // booking: SELECT COUNT confirmed
      .mockResolvedValueOnce(dbResult([runRow({ messages_sent: 0 })])); // UPDATE pipeline_run

    const result = await executePipelineRun(FOUNDER_ID, PROJECT_ID);

    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedChangeLeadStatus).not.toHaveBeenCalled();
    expect(result.messagesSent).toBe(0);
  });

  it('stops sending when throttle limit is reached', async () => {
    vi.useFakeTimers();
    const leads = [
      {
        id: 'l-1',
        name: 'A',
        role: 'CTO',
        company: 'C1',
        industry: 'SaaS',
        email: 'a@c1.com',
        lead_score: 80,
        enrichment_data: { linkedinBio: 'Bio' },
      },
      {
        id: 'l-2',
        name: 'B',
        role: 'CTO',
        company: 'C2',
        industry: 'SaaS',
        email: 'b@c2.com',
        lead_score: 70,
        enrichment_data: { linkedinBio: 'Bio' },
      },
    ];

    // Allow first, deny second
    mockedCanRecordOutreach.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockedGenerateMessageWithResearchFallback.mockResolvedValue({
      message: 'Hello Bio',
      personalizationDetails: ['LinkedIn bio: Bio'],
      limitedPersonalization: false,
    });
    mockedRunAllChecks.mockReturnValue({ passed: true, failures: [] });
    mockedSendEmail.mockResolvedValue({ gmailThreadId: 't-1', gmailMessageId: 'm-1' });
    mockedRecordOutreach.mockResolvedValue({
      id: 'or-1',
      leadId: 'l-1',
      founderId: FOUNDER_ID,
      channel: 'email',
      messageContent: 'Hello',
      outreachDate: new Date(),
      isFollowUp: false,
      createdAt: new Date(),
    });

    mockedQuery
      .mockResolvedValueOnce(dbResult([])) // SELECT stale runs (none)
      .mockResolvedValueOnce(dbResult([runRow({ status: 'running' })])) // INSERT pipeline_run
      .mockResolvedValueOnce(dbResult([])) // enrichment_retry: SELECT leads (none eligible)
      // discovery: getActiveProfiles returns [] so no DB queries
      .mockResolvedValueOnce(dbResult(leads)) // outreach: SELECT leads
      .mockResolvedValueOnce(dbResult([])) // UPDATE outreach_record gmail ids
      .mockResolvedValueOnce(dbResult([])) // follow_up: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT replied leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT expired proposals (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT decline proposals (empty)
      .mockResolvedValueOnce(dbResult([{ count: '0' }])) // booking: SELECT COUNT confirmed
      .mockResolvedValueOnce(dbResult([runRow({ messages_sent: 1 })])); // UPDATE pipeline_run

    const promise = executePipelineRun(FOUNDER_ID, PROJECT_ID);
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await promise;

    // Only 1 message sent, second was throttled
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    expect(result.messagesSent).toBe(1);
    vi.useRealTimers();
  });

  it('records gmail_thread_id and gmail_message_id on outreach_record', async () => {
    const leadRow = {
      id: 'lead-1',
      name: 'Jane',
      role: 'CTO',
      company: 'Acme',
      industry: 'SaaS',
      email: 'jane@acme.com',
      lead_score: 75,
      enrichment_data: { linkedinBio: 'Bio' },
    };

    mockedCanRecordOutreach.mockResolvedValue(true);
    mockedGenerateMessageWithResearchFallback.mockResolvedValue({
      message: 'Hi Bio',
      personalizationDetails: ['Bio'],
      limitedPersonalization: false,
    });
    mockedRunAllChecks.mockReturnValue({ passed: true, failures: [] });
    mockedSendEmail.mockResolvedValue({ gmailThreadId: 'thread-abc', gmailMessageId: 'msg-xyz' });
    mockedRecordOutreach.mockResolvedValue({
      id: 'or-99',
      leadId: 'lead-1',
      founderId: FOUNDER_ID,
      channel: 'email',
      messageContent: 'Hi',
      outreachDate: new Date(),
      isFollowUp: false,
      createdAt: new Date(),
    });

    mockedQuery
      .mockResolvedValueOnce(dbResult([])) // SELECT stale runs (none)
      .mockResolvedValueOnce(dbResult([runRow({ status: 'running' })])) // INSERT pipeline_run
      .mockResolvedValueOnce(dbResult([])) // enrichment_retry: SELECT leads (none eligible)
      // discovery: getActiveProfiles returns [] so no DB queries
      .mockResolvedValueOnce(dbResult([leadRow])) // outreach: SELECT leads
      .mockResolvedValueOnce(dbResult([])) // UPDATE outreach_record gmail ids
      .mockResolvedValueOnce(dbResult([])) // follow_up: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT replied leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT expired proposals (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT decline proposals (empty)
      .mockResolvedValueOnce(dbResult([{ count: '0' }])) // booking: SELECT COUNT confirmed
      .mockResolvedValueOnce(dbResult([runRow({ messages_sent: 1 })])); // UPDATE pipeline_run

    await executePipelineRun(FOUNDER_ID, PROJECT_ID);

    // Verify the UPDATE outreach_record query was called with gmail IDs
    const updateCall = mockedQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('gmail_thread_id'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual(['thread-abc', 'msg-xyz', 'or-99']);
  });
});
