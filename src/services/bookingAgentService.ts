import { query } from '@/lib/db';
import { createEvent, getAvailableSlots } from '@/services/calendarIntegrationService';
import { changeLeadStatus } from '@/services/crmService';
import { sendEmail } from '@/services/emailIntegrationService';
import type { BookingProposal, TimeSlot } from '@/types';

// ---------------------------------------------------------------------------
// DB row type and mapping
// ---------------------------------------------------------------------------

interface BookingProposalRow {
  id: string;
  lead_id: string;
  founder_id: string;
  proposed_slots: unknown;
  status: 'proposed' | 'confirmed' | 'declined' | 'expired';
  proposed_at: Date;
  responded_at: Date | null;
  confirmed_slot: unknown;
  follow_up_sent_at: Date | null;
  created_at: Date;
}

const BOOKING_PROPOSAL_COLUMNS = `id, lead_id, founder_id, proposed_slots, status, proposed_at, responded_at, confirmed_slot, follow_up_sent_at, created_at`;

function parseTimeSlots(raw: unknown): TimeSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: { start: string; end: string }) => ({
    start: new Date(s.start),
    end: new Date(s.end),
  }));
}

function parseTimeSlot(raw: unknown): TimeSlot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as { start: string; end: string };
  return { start: new Date(obj.start), end: new Date(obj.end) };
}

function mapBookingProposalRow(row: BookingProposalRow): BookingProposal {
  return {
    id: row.id,
    leadId: row.lead_id,
    founderId: row.founder_id,
    proposedSlots: parseTimeSlots(row.proposed_slots),
    status: row.status,
    proposedAt: row.proposed_at,
    respondedAt: row.responded_at ?? undefined,
    confirmedSlot: parseTimeSlot(row.confirmed_slot),
    followUpSentAt: row.follow_up_sent_at ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Pure function: select proposal slots
// ---------------------------------------------------------------------------

/**
 * Select up to `maxSlots` slots from the available slots array.
 * Returns min(N, maxSlots) slots. This is a pure function exported
 * for property-based testing (Property 11).
 *
 * Validates: Requirements 7.2
 */
export function selectProposalSlots(availableSlots: TimeSlot[], maxSlots: number): TimeSlot[] {
  const count = Math.min(availableSlots.length, maxSlots);
  return availableSlots.slice(0, count);
}

// ---------------------------------------------------------------------------
// Helper: get lead info for emails
// ---------------------------------------------------------------------------

interface LeadInfo {
  name: string;
  email: string;
  company: string;
  role: string;
}

async function getLeadInfo(leadId: string): Promise<LeadInfo> {
  const result = await query<{ name: string; email: string | null; company: string; role: string }>(
    `SELECT name, email, company, role FROM lead WHERE id = $1 AND is_deleted = false`,
    [leadId],
  );
  if (result.rows.length === 0) {
    throw new Error('LEAD_NOT_FOUND');
  }
  const row = result.rows[0];
  if (!row.email) {
    throw new Error('LEAD_NO_EMAIL');
  }
  return { name: row.name, email: row.email, company: row.company, role: row.role };
}

// ---------------------------------------------------------------------------
// Helper: format slots for email body
// ---------------------------------------------------------------------------

function formatSlotsForEmail(slots: TimeSlot[]): string {
  return slots
    .map((slot, i) => {
      const start = slot.start;
      const day = start.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const endTime = slot.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `  ${i + 1}. ${day} at ${time} – ${endTime}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// proposeSlots
// ---------------------------------------------------------------------------

/**
 * Query calendar for available slots in the next 7 business days,
 * create a BookingProposal with up to 3 slots, and send a proposal email.
 *
 * Requirements: 7.1, 7.2, 7.7
 */
export async function proposeSlots(founderId: string, leadId: string): Promise<BookingProposal> {
  const lead = await getLeadInfo(leadId);

  // Query available slots for the next 7 business days
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() + 1); // Start from tomorrow
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 9); // ~7 business days buffer
  endDate.setHours(23, 59, 59, 999);

  const availableSlots = await getAvailableSlots(founderId, startDate, endDate);

  // Select up to 3 slots (Property 11)
  const proposedSlots = selectProposalSlots(availableSlots, 3);

  if (proposedSlots.length === 0) {
    throw new Error('NO_AVAILABLE_SLOTS');
  }

  // Persist the booking proposal
  const slotsJson = JSON.stringify(
    proposedSlots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
  );

  const result = await query<BookingProposalRow>(
    `INSERT INTO booking_proposal (lead_id, founder_id, proposed_slots, status, proposed_at)
     VALUES ($1, $2, $3::jsonb, 'proposed', NOW())
     RETURNING ${BOOKING_PROPOSAL_COLUMNS}`,
    [leadId, founderId, slotsJson],
  );

  const proposal = mapBookingProposalRow(result.rows[0]);

  // Send proposal email
  const slotList = formatSlotsForEmail(proposedSlots);
  const emailBody = `Hi ${lead.name},\n\nI'd love to set up a time to chat. Here are a few options that work on my end:\n\n${slotList}\n\nPlease let me know which time works best for you, or if none of these work, I'm happy to find another time.\n\nLooking forward to connecting!`;

  await sendEmail(founderId, lead.email, `Let's find a time to connect`, emailBody);

  return proposal;
}

// ---------------------------------------------------------------------------
// handleSlotConfirmation
// ---------------------------------------------------------------------------

/**
 * Handle a prospect confirming a proposed time slot.
 * Creates a calendar event, updates CRM status to Booked, and records
 * the meeting date in the status_change table.
 *
 * Requirements: 7.3, 7.4
 */
export async function handleSlotConfirmation(
  proposalId: string,
  confirmedSlot: TimeSlot,
): Promise<BookingProposal> {
  // Fetch the proposal
  const proposalResult = await query<BookingProposalRow>(
    `SELECT ${BOOKING_PROPOSAL_COLUMNS} FROM booking_proposal WHERE id = $1`,
    [proposalId],
  );
  if (proposalResult.rows.length === 0) {
    throw new Error('PROPOSAL_NOT_FOUND');
  }

  const row = proposalResult.rows[0];
  if (row.status !== 'proposed') {
    throw new Error('PROPOSAL_NOT_PENDING');
  }

  const lead = await getLeadInfo(row.lead_id);

  // Create calendar event (Req 7.3)
  await createEvent(
    row.founder_id,
    row.lead_id,
    `Meeting with ${lead.name} (${lead.company})`,
    `Meeting with ${lead.name}, ${lead.role} at ${lead.company}`,
    confirmedSlot.start,
    confirmedSlot.end,
    lead.email,
  );

  // Update proposal status to confirmed
  const slotJson = JSON.stringify({
    start: confirmedSlot.start.toISOString(),
    end: confirmedSlot.end.toISOString(),
  });

  const updateResult = await query<BookingProposalRow>(
    `UPDATE booking_proposal
     SET status = 'confirmed', responded_at = NOW(), confirmed_slot = $1::jsonb
     WHERE id = $2
     RETURNING ${BOOKING_PROPOSAL_COLUMNS}`,
    [slotJson, proposalId],
  );

  // Update CRM status to Booked with meeting date (Req 7.4)
  await changeLeadStatus({
    leadId: row.lead_id,
    toStatus: 'Booked',
    reason: 'Meeting confirmed via booking agent',
    meetingDate: confirmedSlot.start.toISOString(),
  });

  return mapBookingProposalRow(updateResult.rows[0]);
}

// ---------------------------------------------------------------------------
// handleProposalExpiry
// ---------------------------------------------------------------------------

/**
 * Handle a proposal that has had no response for 48 hours.
 * Sends a follow-up email with updated available time slots.
 *
 * Requirements: 7.5
 */
export async function handleProposalExpiry(proposalId: string): Promise<BookingProposal> {
  const proposalResult = await query<BookingProposalRow>(
    `SELECT ${BOOKING_PROPOSAL_COLUMNS} FROM booking_proposal WHERE id = $1`,
    [proposalId],
  );
  if (proposalResult.rows.length === 0) {
    throw new Error('PROPOSAL_NOT_FOUND');
  }

  const row = proposalResult.rows[0];
  if (row.status !== 'proposed') {
    throw new Error('PROPOSAL_NOT_PENDING');
  }

  // Check if 48 hours have passed since proposal
  const proposedAt = new Date(row.proposed_at);
  const hoursSinceProposal = (Date.now() - proposedAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceProposal < 48) {
    throw new Error('PROPOSAL_NOT_EXPIRED');
  }

  const lead = await getLeadInfo(row.lead_id);

  // Get fresh available slots
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() + 1);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 9);
  endDate.setHours(23, 59, 59, 999);

  const availableSlots = await getAvailableSlots(row.founder_id, startDate, endDate);
  const proposedSlots = selectProposalSlots(availableSlots, 3);

  if (proposedSlots.length === 0) {
    throw new Error('NO_AVAILABLE_SLOTS');
  }

  // Update proposal with new slots and mark follow-up sent
  const slotsJson = JSON.stringify(
    proposedSlots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
  );

  const updateResult = await query<BookingProposalRow>(
    `UPDATE booking_proposal
     SET proposed_slots = $1::jsonb, follow_up_sent_at = NOW()
     WHERE id = $2
     RETURNING ${BOOKING_PROPOSAL_COLUMNS}`,
    [slotsJson, proposalId],
  );

  // Send follow-up email with updated slots
  const slotList = formatSlotsForEmail(proposedSlots);
  const emailBody = `Hi ${lead.name},\n\nJust following up on my earlier message. I'd still love to find a time to connect. Here are some updated availability options:\n\n${slotList}\n\nLet me know if any of these work for you!\n\nBest regards`;

  await sendEmail(row.founder_id, lead.email, `Following up — let's find a time`, emailBody);

  return mapBookingProposalRow(updateResult.rows[0]);
}

// ---------------------------------------------------------------------------
// handleDecline
// ---------------------------------------------------------------------------

/**
 * Handle a prospect declining all proposed time slots.
 * Proposes new slots from the following week.
 *
 * Requirements: 7.6
 */
export async function handleDecline(proposalId: string): Promise<BookingProposal> {
  const proposalResult = await query<BookingProposalRow>(
    `SELECT ${BOOKING_PROPOSAL_COLUMNS} FROM booking_proposal WHERE id = $1`,
    [proposalId],
  );
  if (proposalResult.rows.length === 0) {
    throw new Error('PROPOSAL_NOT_FOUND');
  }

  const row = proposalResult.rows[0];
  if (row.status !== 'proposed') {
    throw new Error('PROPOSAL_NOT_PENDING');
  }

  const lead = await getLeadInfo(row.lead_id);

  // Mark current proposal as declined
  await query(
    `UPDATE booking_proposal SET status = 'declined', responded_at = NOW() WHERE id = $1`,
    [proposalId],
  );

  // Get available slots from the following week (start 7 days out)
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() + 7);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 9);
  endDate.setHours(23, 59, 59, 999);

  const availableSlots = await getAvailableSlots(row.founder_id, startDate, endDate);
  const proposedSlots = selectProposalSlots(availableSlots, 3);

  if (proposedSlots.length === 0) {
    throw new Error('NO_AVAILABLE_SLOTS');
  }

  // Create a new proposal with the following week's slots
  const slotsJson = JSON.stringify(
    proposedSlots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
  );

  const newProposalResult = await query<BookingProposalRow>(
    `INSERT INTO booking_proposal (lead_id, founder_id, proposed_slots, status, proposed_at)
     VALUES ($1, $2, $3::jsonb, 'proposed', NOW())
     RETURNING ${BOOKING_PROPOSAL_COLUMNS}`,
    [row.lead_id, row.founder_id, slotsJson],
  );

  // Send email with new slots
  const slotList = formatSlotsForEmail(proposedSlots);
  const emailBody = `Hi ${lead.name},\n\nNo worries at all! Here are some alternative times from the following week:\n\n${slotList}\n\nHopefully one of these works better. Let me know!\n\nBest regards`;

  await sendEmail(row.founder_id, lead.email, `Some alternative times to connect`, emailBody);

  return mapBookingProposalRow(newProposalResult.rows[0]);
}
