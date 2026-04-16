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
  getActiveProfiles: vi.fn(),
  getICPProfileById: vi.fn(),
}));
vi.mock('@/services/scoringService', () => ({
  calculateLeadScoreV2: vi.fn(),
}));
vi.mock('@/services/enrichmentService', () => ({
  enrichLead: vi.fn(),
}));
vi.mock('@/services/discovery/discoveryEngine', () => ({
  discoverLeadsMultiICP: vi.fn(),
}));
vi.mock('@/services/leadService', () => ({
  createLead: vi.fn(),
  findDuplicate: vi.fn(),
  updateLeadEnrichment: vi.fn(),
}));
vi.mock('@/services/crmService', () => ({
  changeLeadStatus: vi.fn(),
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
}));
vi.mock('@/services/outreachService', () => ({
  getOutreachHistory: vi.fn().mockResolvedValue([]),
  recordOutreach: vi.fn().mockResolvedValue({ id: 'or-1' }),
}));
vi.mock('@/services/qualityGateService', () => ({
  runAllChecks: vi.fn().mockReturnValue({ passed: true, failures: [] }),
}));
vi.mock('@/services/strategyService', () => ({
  extractStrategy: vi.fn().mockReturnValue({
    productContext: '',
    valueProposition: '',
    targetPainPoints: [],
    tonePreference: 'professional',
  }),
  formatStrategyForPrompt: vi.fn().mockReturnValue(''),
}));
vi.mock('@/services/throttleService', () => ({
  canRecordOutreach: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/services/correlationEngineService', () => ({
  scoreAndStoreCorrelation: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/prospectResearcherService', () => ({
  getResearchProfile: vi.fn().mockResolvedValue(null),
}));

import { query } from '@/lib/db';
import { discoverLeadsMultiICP } from '@/services/discovery/discoveryEngine';
import { enrichLead } from '@/services/enrichmentService';
import { getActiveProfiles } from '@/services/icpProfileService';
import { createLead, findDuplicate, updateLeadEnrichment } from '@/services/leadService';
import { getPipelineConfig } from '@/services/pipelineConfigService';
import { calculateLeadScoreV2 } from '@/services/scoringService';
import { executePipelineRun } from './pipelineOrchestratorService';

const mockedQuery = vi.mocked(query);
const mockedGetPipelineConfig = vi.mocked(getPipelineConfig);
const mockedGetActiveProfiles = vi.mocked(getActiveProfiles);
const mockedCalculateLeadScoreV2 = vi.mocked(calculateLeadScoreV2);
const mockedDiscoverLeadsMultiICP = vi.mocked(discoverLeadsMultiICP);
const mockedEnrichLead = vi.mocked(enrichLead);
const mockedCreateLead = vi.mocked(createLead);
const mockedFindDuplicate = vi.mocked(findDuplicate);
const mockedUpdateLeadEnrichment = vi.mocked(updateLeadEnrichment);

const FOUNDER_ID = 'f-1';

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
  productContext: '',
  valueProposition: '',
  targetPainPoints: [],
};

const defaultProfile = {
  id: 'profile-1',
  founderId: FOUNDER_ID,
  targetRole: 'CTO',
  industry: 'SaaS',
  companyStage: 'Series A',
  geography: 'US',
  painPoints: ['scaling infrastructure'],
  buyingSignals: ['hiring engineers'],
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function dbResult(rows: unknown[] = []) {
  return { rows, command: '', rowCount: rows.length, oid: 0, fields: [] };
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    founder_id: FOUNDER_ID,
    status: 'completed',
    stages_completed: ['discovery', 'outreach', 'follow_up', 'inbox', 'booking'],
    stage_errors: {},
    prospects_discovered: 0,
    messages_sent: 0,
    replies_processed: 0,
    meetings_booked: 0,
    started_at: new Date(),
    completed_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetPipelineConfig.mockResolvedValue(defaultConfig);
  mockedGetActiveProfiles.mockResolvedValue([defaultProfile]);
  mockedEnrichLead.mockResolvedValue({
    enrichmentData: { linkedinBio: 'Bio' },
    enrichmentStatus: 'complete',
  });
  mockedUpdateLeadEnrichment.mockResolvedValue(null);
});

describe('executeDiscoveryStage (via executePipelineRun)', () => {
  it('discovers, scores, enriches, and records prospects using multi-ICP', async () => {
    mockedDiscoverLeadsMultiICP.mockResolvedValue({
      prospects: [
        {
          name: 'A',
          role: 'CTO',
          company: 'Co1',
          industry: 'SaaS',
          geography: 'US',
          icpProfileId: 'profile-1',
          score: 75,
        },
      ],
      profileResults: new Map([['profile-1', 1]]),
    });
    mockedFindDuplicate.mockResolvedValue(null);
    mockedCalculateLeadScoreV2.mockReturnValue({
      totalScore: 75,
      breakdown: { icpMatch: 20, roleRelevance: 25, intentSignals: 10, painPointRelevance: 20 },
    });
    mockedCreateLead.mockResolvedValue({ id: 'lead-1', name: 'A', company: 'Co1' } as any);

    mockedQuery
      .mockResolvedValueOnce(dbResult([runRow({ status: 'running' })])) // INSERT pipeline_run
      .mockResolvedValueOnce(dbResult([{ count: '0' }])) // SELECT count (daily cap)
      .mockResolvedValueOnce(dbResult([])) // UPDATE lead discovery_source
      .mockResolvedValueOnce(dbResult([])) // outreach stage: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // follow_up: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT replied leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT expired proposals (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT decline proposals (empty)
      .mockResolvedValueOnce(dbResult([{ count: '0' }])) // booking: SELECT COUNT confirmed
      .mockResolvedValueOnce(dbResult([runRow({ prospects_discovered: 1 })])); // UPDATE pipeline_run

    const result = await executePipelineRun(FOUNDER_ID);

    expect(mockedGetActiveProfiles).toHaveBeenCalledWith(FOUNDER_ID);
    expect(mockedDiscoverLeadsMultiICP).toHaveBeenCalledWith([defaultProfile], 50);
    expect(mockedCalculateLeadScoreV2).toHaveBeenCalled();
    expect(mockedCreateLead).toHaveBeenCalledTimes(1);
    // Verify icpProfileId is passed to createLead
    expect(mockedCreateLead.mock.calls[0][0]).toHaveProperty('icpProfileId', 'profile-1');
    expect(mockedEnrichLead).toHaveBeenCalledWith('A', 'Co1');
    expect(mockedUpdateLeadEnrichment).toHaveBeenCalled();
    expect(result.prospectsDiscovered).toBe(1);
  });

  it('skips duplicates by name and company', async () => {
    mockedDiscoverLeadsMultiICP.mockResolvedValue({
      prospects: [
        {
          name: 'Dup',
          role: 'CTO',
          company: 'Co1',
          industry: 'SaaS',
          geography: 'US',
          icpProfileId: 'profile-1',
          score: 75,
        },
        {
          name: 'New',
          role: 'CTO',
          company: 'Co2',
          industry: 'SaaS',
          geography: 'US',
          icpProfileId: 'profile-1',
          score: 75,
        },
      ],
      profileResults: new Map([['profile-1', 2]]),
    });
    // First lead is a duplicate, second is not
    mockedFindDuplicate
      .mockResolvedValueOnce({ id: 'existing' } as any)
      .mockResolvedValueOnce(null);
    mockedCalculateLeadScoreV2.mockReturnValue({
      totalScore: 75,
      breakdown: { icpMatch: 20, roleRelevance: 25, intentSignals: 10, painPointRelevance: 20 },
    });
    mockedCreateLead.mockResolvedValue({ id: 'lead-2', name: 'New', company: 'Co2' } as any);

    mockedQuery
      .mockResolvedValueOnce(dbResult([runRow({ status: 'running' })]))
      .mockResolvedValueOnce(dbResult([{ count: '0' }]))
      .mockResolvedValueOnce(dbResult([])) // UPDATE discovery_source for New
      .mockResolvedValueOnce(dbResult([])) // outreach stage: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // follow_up: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT replied leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT expired proposals (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT decline proposals (empty)
      .mockResolvedValueOnce(dbResult([{ count: '0' }])) // booking: SELECT COUNT confirmed
      .mockResolvedValueOnce(dbResult([runRow({ prospects_discovered: 1 })]));

    const result = await executePipelineRun(FOUNDER_ID);

    expect(mockedFindDuplicate).toHaveBeenCalledTimes(2);
    expect(mockedCreateLead).toHaveBeenCalledTimes(1);
    expect(result.prospectsDiscovered).toBe(1);
  });

  it('filters out prospects below minimum score threshold', async () => {
    mockedDiscoverLeadsMultiICP.mockResolvedValue({
      prospects: [
        {
          name: 'Low',
          role: 'Intern',
          company: 'Co1',
          industry: 'SaaS',
          geography: 'US',
          icpProfileId: 'profile-1',
          score: 30,
        },
      ],
      profileResults: new Map([['profile-1', 1]]),
    });
    mockedFindDuplicate.mockResolvedValue(null);
    mockedCalculateLeadScoreV2.mockReturnValue({
      totalScore: 30, // Below minLeadScore of 50
      breakdown: { icpMatch: 10, roleRelevance: 10, intentSignals: 5, painPointRelevance: 5 },
    });

    mockedQuery
      .mockResolvedValueOnce(dbResult([runRow({ status: 'running' })]))
      .mockResolvedValueOnce(dbResult([{ count: '0' }]))
      .mockResolvedValueOnce(dbResult([])) // outreach stage: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // follow_up: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT replied leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT expired proposals (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT decline proposals (empty)
      .mockResolvedValueOnce(dbResult([{ count: '0' }])) // booking: SELECT COUNT confirmed
      .mockResolvedValueOnce(dbResult([runRow({ prospects_discovered: 0 })]));

    const result = await executePipelineRun(FOUNDER_ID);

    expect(mockedCreateLead).not.toHaveBeenCalled();
    expect(result.prospectsDiscovered).toBe(0);
  });

  it('returns 0 prospects when daily cap is already reached', async () => {
    mockedQuery
      .mockResolvedValueOnce(dbResult([runRow({ status: 'running' })]))
      .mockResolvedValueOnce(dbResult([{ count: '50' }])) // Cap already reached
      .mockResolvedValueOnce(dbResult([])) // outreach stage: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // follow_up: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT replied leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT expired proposals (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT decline proposals (empty)
      .mockResolvedValueOnce(dbResult([{ count: '0' }])) // booking: SELECT COUNT confirmed
      .mockResolvedValueOnce(dbResult([runRow({ prospects_discovered: 0 })]));

    const result = await executePipelineRun(FOUNDER_ID);

    expect(mockedCreateLead).not.toHaveBeenCalled();
    expect(result.prospectsDiscovered).toBe(0);
  });

  it('records discovery source and timestamp on each new lead', async () => {
    mockedDiscoverLeadsMultiICP.mockResolvedValue({
      prospects: [
        {
          name: 'A',
          role: 'CTO',
          company: 'Co1',
          industry: 'SaaS',
          geography: 'US',
          icpProfileId: 'profile-1',
          score: 75,
        },
      ],
      profileResults: new Map([['profile-1', 1]]),
    });
    mockedFindDuplicate.mockResolvedValue(null);
    mockedCalculateLeadScoreV2.mockReturnValue({
      totalScore: 75,
      breakdown: { icpMatch: 20, roleRelevance: 25, intentSignals: 10, painPointRelevance: 20 },
    });
    mockedCreateLead.mockResolvedValue({ id: 'lead-1', name: 'A', company: 'Co1' } as any);

    mockedQuery
      .mockResolvedValueOnce(dbResult([runRow({ status: 'running' })]))
      .mockResolvedValueOnce(dbResult([{ count: '0' }]))
      .mockResolvedValueOnce(dbResult([])) // UPDATE discovery_source
      .mockResolvedValueOnce(dbResult([])) // outreach stage: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // follow_up: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT replied leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT expired proposals (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT decline proposals (empty)
      .mockResolvedValueOnce(dbResult([{ count: '0' }])) // booking: SELECT COUNT confirmed
      .mockResolvedValueOnce(dbResult([runRow({ prospects_discovered: 1 })]));

    await executePipelineRun(FOUNDER_ID);

    // 3rd query call = UPDATE lead SET discovery_source
    const updateCall = mockedQuery.mock.calls[2];
    expect(updateCall[0]).toContain('discovery_source');
    expect(updateCall[0]).toContain('discovered_at');
    expect(updateCall[1]).toEqual(['icp_discovery', 'lead-1']);
  });

  it('skips discovery stage with warning when no active profiles exist', async () => {
    mockedGetActiveProfiles.mockResolvedValue([]);

    mockedQuery
      .mockResolvedValueOnce(dbResult([runRow({ status: 'running' })]))
      .mockResolvedValueOnce(dbResult([])) // outreach stage: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // follow_up: SELECT leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT replied leads (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT expired proposals (empty)
      .mockResolvedValueOnce(dbResult([])) // booking: SELECT decline proposals (empty)
      .mockResolvedValueOnce(dbResult([{ count: '0' }])) // booking: SELECT COUNT confirmed
      .mockResolvedValueOnce(dbResult([runRow({ prospects_discovered: 0 })]));

    const result = await executePipelineRun(FOUNDER_ID);

    // Discovery stage should complete successfully with 0 prospects (not throw)
    expect(result.stagesCompleted).toContain('discovery');
    expect(mockedDiscoverLeadsMultiICP).not.toHaveBeenCalled();
    expect(result.prospectsDiscovered).toBe(0);
  });
});
