import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => {
  return {
    query: vi.fn(),
    default: {},
  };
});

import { query } from '@/lib/db';
import {
  createLead,
  findDuplicate,
  getLeadById,
  listLeads,
  restoreLead,
  softDeleteLead,
  updateLead,
} from './leadService';

const mockedQuery = vi.mocked(query);

function makeLeadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    founder_id: 'founder-1',
    name: 'Alice',
    role: 'CTO',
    company: 'Acme',
    industry: 'SaaS',
    geography: 'US',
    lead_score: 85,
    score_breakdown: { icpMatch: 35, roleRelevance: 30, intentSignals: 20 },
    enrichment_status: 'pending',
    enrichment_data: null,
    crm_status: 'New',
    is_deleted: false,
    deleted_at: null,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createLead', () => {
  it('inserts a lead and returns mapped Lead object', async () => {
    const row = makeLeadRow();
    mockedQuery.mockResolvedValueOnce({
      rows: [row],
      command: '',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const lead = await createLead(
      { founderId: 'founder-1', name: 'Alice', role: 'CTO', company: 'Acme' },
      85,
      { icpMatch: 35, roleRelevance: 30, intentSignals: 20 },
    );

    expect(lead.id).toBe('lead-1');
    expect(lead.name).toBe('Alice');
    expect(lead.founderId).toBe('founder-1');
    expect(lead.leadScore).toBe(85);
    expect(lead.crmStatus).toBe('New');
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });
});

describe('findDuplicate', () => {
  it('returns null when no duplicate exists', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });
    const result = await findDuplicate('founder-1', 'Alice', 'Acme');
    expect(result).toBeNull();
  });

  it('returns the existing lead when a duplicate is found', async () => {
    const row = makeLeadRow();
    mockedQuery.mockResolvedValueOnce({
      rows: [row],
      command: '',
      rowCount: 1,
      oid: 0,
      fields: [],
    });
    const result = await findDuplicate('founder-1', 'Alice', 'Acme');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('lead-1');
  });
});

describe('getLeadById', () => {
  it('returns null when lead not found', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });
    const result = await getLeadById('nonexistent');
    expect(result).toBeNull();
  });

  it('returns mapped lead when found', async () => {
    const row = makeLeadRow();
    mockedQuery.mockResolvedValueOnce({
      rows: [row],
      command: '',
      rowCount: 1,
      oid: 0,
      fields: [],
    });
    const result = await getLeadById('lead-1');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Alice');
    expect(result!.industry).toBe('SaaS');
  });

  it('maps null optional fields to undefined', async () => {
    const row = makeLeadRow({
      industry: null,
      geography: null,
      enrichment_data: null,
      deleted_at: null,
    });
    mockedQuery.mockResolvedValueOnce({
      rows: [row],
      command: '',
      rowCount: 1,
      oid: 0,
      fields: [],
    });
    const result = await getLeadById('lead-1');
    expect(result!.industry).toBeUndefined();
    expect(result!.geography).toBeUndefined();
    expect(result!.enrichmentData).toBeUndefined();
    expect(result!.deletedAt).toBeUndefined();
  });
});

describe('listLeads', () => {
  it('returns leads sorted by score by default', async () => {
    const rows = [makeLeadRow({ lead_score: 90 }), makeLeadRow({ id: 'lead-2', lead_score: 70 })];
    mockedQuery.mockResolvedValueOnce({ rows, command: '', rowCount: 2, oid: 0, fields: [] });

    const leads = await listLeads({ founderId: 'founder-1' });
    expect(leads).toHaveLength(2);
    // Verify the query was called with ORDER BY lead_score DESC
    const callArgs = mockedQuery.mock.calls[0][0] as string;
    expect(callArgs).toContain('lead_score DESC');
  });

  it('applies minScore filter when provided', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });

    await listLeads({ founderId: 'founder-1', minScore: 50 });
    const callArgs = mockedQuery.mock.calls[0][0] as string;
    expect(callArgs).toContain('lead_score >=');
    expect(mockedQuery.mock.calls[0][1]).toContain(50);
  });

  it('supports created sort order', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });

    await listLeads({ founderId: 'founder-1', sortBy: 'created' });
    const callArgs = mockedQuery.mock.calls[0][0] as string;
    expect(callArgs).toContain('created_at DESC');
  });
});

describe('updateLead', () => {
  it('returns null when lead not found', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });
    const result = await updateLead('nonexistent', { name: 'Bob' });
    expect(result).toBeNull();
  });

  it('updates provided fields only', async () => {
    const row = makeLeadRow({ name: 'Bob' });
    mockedQuery.mockResolvedValueOnce({
      rows: [row],
      command: '',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const result = await updateLead('lead-1', { name: 'Bob' });
    expect(result!.name).toBe('Bob');
    const callArgs = mockedQuery.mock.calls[0][0] as string;
    expect(callArgs).toContain('name =');
    expect(callArgs).not.toContain('role =');
  });

  it('returns existing lead when no fields provided', async () => {
    const row = makeLeadRow();
    mockedQuery.mockResolvedValueOnce({
      rows: [row],
      command: '',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const result = await updateLead('lead-1', {});
    expect(result).not.toBeNull();
    // Should call getLeadById instead of UPDATE
    const callArgs = mockedQuery.mock.calls[0][0] as string;
    expect(callArgs).toContain('SELECT');
  });
});

describe('softDeleteLead', () => {
  it('sets is_deleted and deleted_at', async () => {
    const row = makeLeadRow({ is_deleted: true, deleted_at: new Date() });
    mockedQuery.mockResolvedValueOnce({
      rows: [row],
      command: '',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const result = await softDeleteLead('lead-1');
    expect(result!.isDeleted).toBe(true);
    expect(result!.deletedAt).toBeDefined();
  });

  it('returns null when lead not found or already deleted', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });
    const result = await softDeleteLead('nonexistent');
    expect(result).toBeNull();
  });
});

describe('restoreLead', () => {
  it('clears is_deleted and deleted_at', async () => {
    const row = makeLeadRow({ is_deleted: false, deleted_at: null });
    mockedQuery.mockResolvedValueOnce({
      rows: [row],
      command: '',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const result = await restoreLead('lead-1');
    expect(result!.isDeleted).toBe(false);
    expect(result!.deletedAt).toBeUndefined();
  });

  it('returns null when lead not found or not deleted', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], command: '', rowCount: 0, oid: 0, fields: [] });
    const result = await restoreLead('nonexistent');
    expect(result).toBeNull();
  });
});
