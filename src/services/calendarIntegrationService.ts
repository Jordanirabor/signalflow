import { query } from '@/lib/db';
import { decrypt, encrypt } from '@/services/emailIntegrationService';
import type { AvailabilityWindow, CalendarConnection, CalendarEvent, TimeSlot } from '@/types';
import { google } from 'googleapis';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const GOOGLE_CALENDAR_REDIRECT_URI = process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? '';

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

// ---------------------------------------------------------------------------
// OAuth 2.0 helpers
// ---------------------------------------------------------------------------

function getOAuth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_CALENDAR_REDIRECT_URI,
  );
}

/**
 * Generate the Google Calendar OAuth authorization URL.
 * Requirements: 8.1
 */
export function getCalendarAuthorizeUrl(state?: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: CALENDAR_SCOPES,
    state,
  });
}

/**
 * Exchange an authorization code for tokens and persist the calendar connection.
 * Verifies the connection by reading upcoming events.
 * Requirements: 8.1, 8.2
 */
export async function handleCalendarOAuthCallback(
  founderId: string,
  code: string,
): Promise<CalendarConnection> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);

  client.setCredentials(tokens);

  // Use 'primary' as the default calendar ID
  const calendarId = 'primary';

  const accessToken = encrypt(tokens.access_token ?? '');
  const refreshToken = encrypt(tokens.refresh_token ?? '');
  const tokenExpiresAt = new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000);

  // Upsert calendar connection
  const result = await query<CalendarConnectionRow>(
    `INSERT INTO calendar_connection (founder_id, calendar_id, provider, access_token, refresh_token, token_expires_at, is_active)
     VALUES ($1, $2, 'google', $3, $4, $5, true)
     ON CONFLICT (founder_id) DO UPDATE SET
       calendar_id = EXCLUDED.calendar_id,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       is_active = true
     RETURNING ${CALENDAR_CONNECTION_COLUMNS}`,
    [founderId, calendarId, accessToken, refreshToken, tokenExpiresAt],
  );

  const connection = mapCalendarConnectionRow(result.rows[0]);

  // Verify connection by reading upcoming events (Req 8.2)
  await verifyConnection(connection);

  return connection;
}

// ---------------------------------------------------------------------------
// DB row types and mapping
// ---------------------------------------------------------------------------

interface CalendarConnectionRow {
  id: string;
  founder_id: string;
  calendar_id: string;
  provider: 'google';
  access_token: string;
  refresh_token: string;
  token_expires_at: Date;
  is_active: boolean;
  created_at: Date;
}

const CALENDAR_CONNECTION_COLUMNS = `id, founder_id, calendar_id, provider, access_token, refresh_token, token_expires_at, is_active, created_at`;

function mapCalendarConnectionRow(row: CalendarConnectionRow): CalendarConnection {
  return {
    id: row.id,
    founderId: row.founder_id,
    calendarId: row.calendar_id,
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

interface AvailabilityWindowRow {
  id: string;
  founder_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string;
}

function mapAvailabilityWindowRow(row: AvailabilityWindowRow): AvailabilityWindow {
  return {
    founderId: row.founder_id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    timezone: row.timezone,
  };
}

interface CalendarEventRow {
  id: string;
  calendar_event_id: string;
  founder_id: string;
  lead_id: string;
  title: string;
  description: string;
  start_time: Date;
  end_time: Date;
  attendee_email: string;
  created_at: Date;
}

function mapCalendarEventRow(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    calendarEventId: row.calendar_event_id,
    founderId: row.founder_id,
    leadId: row.lead_id,
    title: row.title,
    description: row.description,
    startTime: row.start_time,
    endTime: row.end_time,
    attendeeEmail: row.attendee_email,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get an authenticated OAuth2 client for a founder's calendar connection,
 * refreshing the token automatically if it's within 5 minutes of expiry.
 * Requirements: 8.5
 */
async function getAuthenticatedClient(
  connection: CalendarConnection,
): Promise<InstanceType<typeof google.auth.OAuth2>> {
  const client = getOAuth2Client();
  client.setCredentials({
    access_token: decrypt(connection.accessToken),
    refresh_token: decrypt(connection.refreshToken),
    expiry_date: connection.tokenExpiresAt.getTime(),
  });

  const now = Date.now();
  const expiresAt = connection.tokenExpiresAt.getTime();

  if (expiresAt - now < TOKEN_REFRESH_BUFFER_MS) {
    try {
      const { credentials } = await client.refreshAccessToken();
      const newAccessToken = encrypt(credentials.access_token ?? '');
      const newExpiresAt = new Date(credentials.expiry_date ?? now + 3600 * 1000);

      await query(
        `UPDATE calendar_connection SET access_token = $1, token_expires_at = $2 WHERE id = $3`,
        [newAccessToken, newExpiresAt, connection.id],
      );

      client.setCredentials(credentials);
    } catch {
      // Token refresh failed — likely revoked. Deactivate connection.
      await deactivateCalendarConnection(connection.id);
      throw new Error('CALENDAR_TOKEN_EXPIRED');
    }
  }

  return client;
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

/**
 * Get the active calendar connection for a founder.
 */
export async function getCalendarConnection(founderId: string): Promise<CalendarConnection | null> {
  const result = await query<CalendarConnectionRow>(
    `SELECT ${CALENDAR_CONNECTION_COLUMNS} FROM calendar_connection WHERE founder_id = $1`,
    [founderId],
  );
  if (result.rows.length === 0) return null;
  return mapCalendarConnectionRow(result.rows[0]);
}

/**
 * Check if a founder has an active calendar connection.
 * Requirements: 8.5
 */
export async function getCalendarConnectionStatus(
  founderId: string,
): Promise<{ connected: boolean; calendarId?: string; isActive?: boolean }> {
  const conn = await getCalendarConnection(founderId);
  if (!conn) return { connected: false };
  return {
    connected: true,
    calendarId: conn.calendarId,
    isActive: conn.isActive,
  };
}

/**
 * Deactivate a calendar connection (e.g. on token revocation).
 * Requirements: 8.5
 */
export async function deactivateCalendarConnection(connectionId: string): Promise<void> {
  await query(`UPDATE calendar_connection SET is_active = false WHERE id = $1`, [connectionId]);
}

/**
 * Disconnect (delete) the calendar connection for a founder.
 */
export async function disconnectCalendar(founderId: string): Promise<void> {
  await query(`DELETE FROM calendar_connection WHERE founder_id = $1`, [founderId]);
}

// ---------------------------------------------------------------------------
// Connection verification
// ---------------------------------------------------------------------------

/**
 * Verify the calendar connection by reading upcoming events.
 * Requirements: 8.2
 */
async function verifyConnection(connection: CalendarConnection): Promise<void> {
  const client = await getAuthenticatedClient(connection);
  const calendar = google.calendar({ version: 'v3', auth: client });

  await calendar.events.list({
    calendarId: connection.calendarId || 'primary',
    timeMin: new Date().toISOString(),
    maxResults: 5,
    singleEvents: true,
    orderBy: 'startTime',
  });
}

// ---------------------------------------------------------------------------
// Availability window CRUD
// ---------------------------------------------------------------------------

/**
 * Get all availability windows for a founder.
 * Requirements: 8.6
 */
export async function getAvailabilityWindows(founderId: string): Promise<AvailabilityWindow[]> {
  const result = await query<AvailabilityWindowRow>(
    `SELECT id, founder_id, day_of_week, start_time, end_time, timezone
     FROM availability_window
     WHERE founder_id = $1
     ORDER BY day_of_week`,
    [founderId],
  );
  return result.rows.map(mapAvailabilityWindowRow);
}

/**
 * Upsert an availability window for a specific day of the week.
 * Requirements: 8.6
 */
export async function upsertAvailabilityWindow(
  founderId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  timezone: string,
): Promise<AvailabilityWindow> {
  const result = await query<AvailabilityWindowRow>(
    `INSERT INTO availability_window (founder_id, day_of_week, start_time, end_time, timezone)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (founder_id, day_of_week) DO UPDATE SET
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       timezone = EXCLUDED.timezone
     RETURNING id, founder_id, day_of_week, start_time, end_time, timezone`,
    [founderId, dayOfWeek, startTime, endTime, timezone],
  );
  return mapAvailabilityWindowRow(result.rows[0]);
}

/**
 * Delete an availability window for a specific day of the week.
 * Requirements: 8.6
 */
export async function deleteAvailabilityWindow(
  founderId: string,
  dayOfWeek: number,
): Promise<void> {
  await query(`DELETE FROM availability_window WHERE founder_id = $1 AND day_of_week = $2`, [
    founderId,
    dayOfWeek,
  ]);
}

// ---------------------------------------------------------------------------
// Available slots computation
// ---------------------------------------------------------------------------

/**
 * Compute available meeting slots for a founder within a date range.
 * Reads existing calendar events, then subtracts busy periods from
 * the founder's availability windows.
 *
 * Requirements: 8.3
 */
export async function getAvailableSlots(
  founderId: string,
  startDate: Date,
  endDate: Date,
): Promise<TimeSlot[]> {
  const connection = await getCalendarConnection(founderId);
  if (!connection || !connection.isActive) {
    throw new Error('CALENDAR_NOT_CONNECTED');
  }

  const windows = await getAvailabilityWindows(founderId);
  if (windows.length === 0) return [];

  // Fetch busy periods from Google Calendar
  const busySlots = await fetchBusySlots(connection, startDate, endDate);

  // Compute free slots from availability windows minus busy periods
  return computeFreeSlots(windows, busySlots, startDate, endDate);
}

/**
 * Fetch busy time slots from Google Calendar using the freebusy API.
 */
async function fetchBusySlots(
  connection: CalendarConnection,
  startDate: Date,
  endDate: Date,
): Promise<TimeSlot[]> {
  const client = await getAuthenticatedClient(connection);
  const calendar = google.calendar({ version: 'v3', auth: client });

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      items: [{ id: connection.calendarId || 'primary' }],
    },
  });

  const calendarBusy = response.data.calendars?.[connection.calendarId || 'primary']?.busy ?? [];

  return calendarBusy.map((slot) => ({
    start: new Date(slot.start ?? startDate),
    end: new Date(slot.end ?? endDate),
  }));
}

/**
 * Compute free time slots from availability windows minus busy periods.
 * This is a pure function used for available slots computation.
 *
 * Requirements: 8.3 (Property 13)
 */
export function computeFreeSlots(
  windows: AvailabilityWindow[],
  busySlots: TimeSlot[],
  startDate: Date,
  endDate: Date,
): TimeSlot[] {
  const freeSlots: TimeSlot[] = [];

  // Build a map of day-of-week to availability window
  const windowMap = new Map<number, AvailabilityWindow>();
  for (const w of windows) {
    windowMap.set(w.dayOfWeek, w);
  }

  // Iterate day by day from startDate to endDate
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    const dayOfWeek = current.getDay(); // 0=Sun..6=Sat
    const window = windowMap.get(dayOfWeek);

    if (window) {
      const [startH, startM] = window.startTime.split(':').map(Number);
      const [endH, endM] = window.endTime.split(':').map(Number);

      const windowStart = new Date(current);
      windowStart.setHours(startH, startM, 0, 0);

      const windowEnd = new Date(current);
      windowEnd.setHours(endH, endM, 0, 0);

      // Clamp to the query range
      const effectiveStart = windowStart < startDate ? startDate : windowStart;
      const effectiveEnd = windowEnd > endDate ? endDate : windowEnd;

      if (effectiveStart < effectiveEnd) {
        // Subtract busy slots from this window
        const dayFreeSlots = subtractBusyFromWindow(effectiveStart, effectiveEnd, busySlots);
        freeSlots.push(...dayFreeSlots);
      }
    }

    // Move to next day
    current.setDate(current.getDate() + 1);
  }

  return freeSlots;
}

/**
 * Subtract busy periods from a single availability window, returning free slots.
 */
function subtractBusyFromWindow(
  windowStart: Date,
  windowEnd: Date,
  busySlots: TimeSlot[],
): TimeSlot[] {
  // Filter busy slots that overlap with this window
  const overlapping = busySlots
    .filter((b) => b.start < windowEnd && b.end > windowStart)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (overlapping.length === 0) {
    return [{ start: windowStart, end: windowEnd }];
  }

  const freeSlots: TimeSlot[] = [];
  let cursor = windowStart;

  for (const busy of overlapping) {
    const busyStart = busy.start < windowStart ? windowStart : busy.start;
    const busyEnd = busy.end > windowEnd ? windowEnd : busy.end;

    if (cursor < busyStart) {
      freeSlots.push({ start: new Date(cursor), end: new Date(busyStart) });
    }

    if (busyEnd > cursor) {
      cursor = busyEnd;
    }
  }

  if (cursor < windowEnd) {
    freeSlots.push({ start: new Date(cursor), end: new Date(windowEnd) });
  }

  return freeSlots;
}

// ---------------------------------------------------------------------------
// Create calendar event
// ---------------------------------------------------------------------------

/**
 * Create a calendar event with an invite sent to the attendee.
 * Requirements: 8.4
 */
export async function createEvent(
  founderId: string,
  leadId: string,
  title: string,
  description: string,
  startTime: Date,
  endTime: Date,
  attendeeEmail: string,
): Promise<CalendarEvent> {
  const connection = await getCalendarConnection(founderId);
  if (!connection || !connection.isActive) {
    throw new Error('CALENDAR_NOT_CONNECTED');
  }

  const client = await getAuthenticatedClient(connection);
  const calendar = google.calendar({ version: 'v3', auth: client });

  const response = await calendar.events.insert({
    calendarId: connection.calendarId || 'primary',
    sendUpdates: 'all', // Send invite to attendee
    requestBody: {
      summary: title,
      description,
      start: {
        dateTime: startTime.toISOString(),
      },
      end: {
        dateTime: endTime.toISOString(),
      },
      attendees: [{ email: attendeeEmail }],
    },
  });

  const calendarEventId = response.data.id ?? '';

  // Persist the event in our database
  const result = await query<CalendarEventRow>(
    `INSERT INTO calendar_event (calendar_event_id, founder_id, lead_id, title, description, start_time, end_time, attendee_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, calendar_event_id, founder_id, lead_id, title, description, start_time, end_time, attendee_email, created_at`,
    [calendarEventId, founderId, leadId, title, description, startTime, endTime, attendeeEmail],
  );

  return mapCalendarEventRow(result.rows[0]);
}
