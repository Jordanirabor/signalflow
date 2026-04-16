'use client';

import { FOUNDER_ID } from '@/lib/constants';
import type { CalendarEvent, TimeSlot } from '@/types';
import { useCallback, useEffect, useState } from 'react';

/** Hours displayed in the grid (8 AM – 6 PM). */
const START_HOUR = 8;
const END_HOUR = 18;
const TOTAL_HOURS = END_HOUR - START_HOUR;

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Return Monday 00:00 of the current week. */
function getWeekMonday(): Date {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // days since Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** Map dayOfWeek (0=Sun..6=Sat) to grid column index (0=Mon..6=Sun). */
function dayOfWeekToColumnIndex(dow: number): number {
  return dow === 0 ? 6 : dow - 1;
}

/** Compute top offset (%) and height (%) for a time range within the grid. */
function timePosition(start: Date, end: Date): { top: string; height: string } {
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const gridStartMin = START_HOUR * 60;
  const gridEndMin = END_HOUR * 60;
  const gridRange = gridEndMin - gridStartMin;

  const clampedStart = Math.max(startMinutes, gridStartMin);
  const clampedEnd = Math.min(endMinutes, gridEndMin);

  const topPct = ((clampedStart - gridStartMin) / gridRange) * 100;
  const heightPct = ((clampedEnd - clampedStart) / gridRange) * 100;

  return { top: `${topPct}%`, height: `${Math.max(heightPct, 2)}%` };
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function CalendarWeekView() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monday = getWeekMonday();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventsRes, slotsRes] = await Promise.all([
        fetch(`/api/pipeline/calendar/week?founderId=${FOUNDER_ID}`),
        fetch(`/api/pipeline/calendar/slots?founderId=${FOUNDER_ID}`),
      ]);

      if (!eventsRes.ok) {
        const err = await eventsRes.json();
        setError(err.message ?? 'Failed to load calendar events');
        return;
      }

      const eventsData: CalendarEvent[] = await eventsRes.json();
      setEvents(eventsData);

      // Slots may fail if calendar not connected — non-fatal
      if (slotsRes.ok) {
        const slotsData = await slotsRes.json();
        setSlots(
          (slotsData.slots ?? []).map((s: { start: string; end: string }) => ({
            start: new Date(s.start),
            end: new Date(s.end),
          })),
        );
      }
    } catch {
      setError('Network error loading calendar data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** Group events by column index (0=Mon..6=Sun). */
  function eventsByDay(): Map<number, CalendarEvent[]> {
    const map = new Map<number, CalendarEvent[]>();
    for (const ev of events) {
      const d = new Date(ev.startTime);
      const col = dayOfWeekToColumnIndex(d.getDay());
      if (!map.has(col)) map.set(col, []);
      map.get(col)!.push(ev);
    }
    return map;
  }

  /** Group availability slots by column index. */
  function slotsByDay(): Map<number, TimeSlot[]> {
    const map = new Map<number, TimeSlot[]>();
    for (const slot of slots) {
      const d = new Date(slot.start);
      const col = dayOfWeekToColumnIndex(d.getDay());
      if (!map.has(col)) map.set(col, []);
      map.get(col)!.push(slot);
    }
    return map;
  }

  /** Format the week range label, e.g. "Jun 9 – Jun 15, 2025". */
  function weekRangeLabel(): string {
    const sun = new Date(monday);
    sun.setDate(monday.getDate() + 6);
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const monStr = monday.toLocaleDateString(undefined, opts);
    const sunStr = sun.toLocaleDateString(undefined, { ...opts, year: 'numeric' });
    return `${monStr} – ${sunStr}`;
  }

  if (loading) {
    return (
      <div className="dashboard-loading" role="status" aria-live="polite">
        Loading calendar...
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-error" role="alert">
        <p>{error}</p>
        <button type="button" className="action-btn" onClick={fetchData}>
          Retry
        </button>
      </div>
    );
  }

  const evMap = eventsByDay();
  const slMap = slotsByDay();

  return (
    <div className="calendar-week-view">
      <h2>Calendar — {weekRangeLabel()}</h2>

      <div className="calendar-grid" role="grid" aria-label="Weekly calendar">
        {/* Time gutter */}
        <div className="calendar-gutter" role="presentation">
          <div className="calendar-gutter-header" />
          {Array.from({ length: TOTAL_HOURS }, (_, i) => {
            const hour = START_HOUR + i;
            const label = `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;
            return (
              <div key={hour} className="calendar-gutter-cell">
                {label}
              </div>
            );
          })}
        </div>

        {/* Day columns */}
        {DAY_LABELS.map((label, colIdx) => {
          const colDate = new Date(monday);
          colDate.setDate(monday.getDate() + colIdx);
          const isToday = new Date().toDateString() === colDate.toDateString();
          const dayEvents = evMap.get(colIdx) ?? [];
          const daySlots = slMap.get(colIdx) ?? [];

          return (
            <div
              key={label}
              className={`calendar-day-column${isToday ? ' calendar-day-today' : ''}`}
              role="gridcell"
              aria-label={`${label} ${colDate.toLocaleDateString()}`}
            >
              <div className="calendar-day-header">
                <span className="calendar-day-label">{label}</span>
                <span className="calendar-day-date">{colDate.getDate()}</span>
              </div>

              <div className="calendar-day-body">
                {/* Hour grid lines */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={i}
                    className="calendar-hour-line"
                    style={{ top: `${(i / TOTAL_HOURS) * 100}%` }}
                  />
                ))}

                {/* Availability windows overlay */}
                {daySlots.map((slot, i) => {
                  const pos = timePosition(new Date(slot.start), new Date(slot.end));
                  return (
                    <div
                      key={`avail-${i}`}
                      className="calendar-availability-slot"
                      style={{ top: pos.top, height: pos.height }}
                      aria-label="Available time slot"
                    />
                  );
                })}

                {/* Meeting events */}
                {dayEvents.map((ev) => {
                  const start = new Date(ev.startTime);
                  const end = new Date(ev.endTime);
                  const pos = timePosition(start, end);
                  // Extract prospect name from title (format: "Meeting with <Name>")
                  const prospectName = ev.title.replace(/^Meeting with\s*/i, '') || ev.title;

                  return (
                    <div
                      key={ev.id}
                      className="calendar-event"
                      style={{ top: pos.top, height: pos.height }}
                      title={ev.description}
                    >
                      <span className="calendar-event-time">
                        {formatTime(start)} – {formatTime(end)}
                      </span>
                      <span className="calendar-event-name">{prospectName}</span>
                      {ev.description && (
                        <span className="calendar-event-desc">{ev.description}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {events.length === 0 && <p className="empty-state">No meetings booked this week.</p>}
    </div>
  );
}
