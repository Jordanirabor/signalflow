import type { TimeSlot } from '@/types';
import { describe, expect, it } from 'vitest';
import { selectProposalSlots } from './bookingAgentService';

// ---------------------------------------------------------------------------
// Helper to create TimeSlot arrays
// ---------------------------------------------------------------------------

function makeSlots(count: number): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const base = new Date('2025-01-06T09:00:00Z');
  for (let i = 0; i < count; i++) {
    const start = new Date(base.getTime() + i * 60 * 60 * 1000); // 1h apart
    const end = new Date(start.getTime() + 30 * 60 * 1000); // 30min slots
    slots.push({ start, end });
  }
  return slots;
}

// ---------------------------------------------------------------------------
// selectProposalSlots — unit tests
// ---------------------------------------------------------------------------

describe('selectProposalSlots', () => {
  it('returns empty array when no slots available', () => {
    expect(selectProposalSlots([], 3)).toEqual([]);
  });

  it('returns all slots when fewer than maxSlots', () => {
    const slots = makeSlots(2);
    const result = selectProposalSlots(slots, 3);
    expect(result).toHaveLength(2);
    expect(result).toEqual(slots);
  });

  it('returns exactly maxSlots when more are available', () => {
    const slots = makeSlots(10);
    const result = selectProposalSlots(slots, 3);
    expect(result).toHaveLength(3);
    expect(result).toEqual(slots.slice(0, 3));
  });

  it('returns exactly 1 slot when only 1 available and maxSlots is 3', () => {
    const slots = makeSlots(1);
    const result = selectProposalSlots(slots, 3);
    expect(result).toHaveLength(1);
  });

  it('returns exactly maxSlots when count equals maxSlots', () => {
    const slots = makeSlots(3);
    const result = selectProposalSlots(slots, 3);
    expect(result).toHaveLength(3);
    expect(result).toEqual(slots);
  });

  it('respects maxSlots of 1', () => {
    const slots = makeSlots(5);
    const result = selectProposalSlots(slots, 1);
    expect(result).toHaveLength(1);
  });

  it('returns empty when maxSlots is 0', () => {
    const slots = makeSlots(5);
    const result = selectProposalSlots(slots, 0);
    expect(result).toHaveLength(0);
  });
});
