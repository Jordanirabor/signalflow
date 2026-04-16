// ============================================================
// Source Health Monitor — Circuit Breaker Pattern
// ============================================================

import type { SourceAdapter, SourceHealth, SourceHealthState } from './types';

// ---------------------------------------------------------------------------
// Internal State
// ---------------------------------------------------------------------------

/** Per-source health tracking */
const healthMap = new Map<string, SourceHealth>();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Number of consecutive failures before disabling a source */
const FAILURE_THRESHOLD = 5;

/** Default cooldown in milliseconds (15 minutes) */
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

function readCooldownMs(): number {
  const raw = process.env.SOURCE_HEALTH_COOLDOWN_MINUTES;
  if (raw === undefined || raw === '') return DEFAULT_COOLDOWN_MS;
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) || parsed <= 0 ? DEFAULT_COOLDOWN_MS : parsed * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOrCreateHealth(source: string): SourceHealth {
  const existing = healthMap.get(source);
  if (existing) return existing;

  const health: SourceHealth = {
    source,
    state: 'healthy',
    consecutiveFailures: 0,
    lastFailureAt: null,
    disabledUntil: null,
    totalRequests: 0,
    totalFailures: 0,
  };
  healthMap.set(source, health);
  return health;
}

function transitionState(health: SourceHealth, newState: SourceHealthState): void {
  const oldState = health.state;
  if (oldState === newState) return;

  health.state = newState;
  console.log(
    `[HealthMonitor] Source "${health.source}" state transition: ${oldState} → ${newState}. ` +
      `Consecutive failures: ${health.consecutiveFailures}, ` +
      `Timestamp: ${new Date().toISOString()}`,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a successful request for a source.
 * Resets the consecutive failure count to 0 and transitions to healthy.
 */
export function recordSuccess(source: string): void {
  const health = getOrCreateHealth(source);
  health.totalRequests += 1;
  health.consecutiveFailures = 0;
  health.disabledUntil = null;

  if (health.state !== 'healthy') {
    transitionState(health, 'healthy');
  }
}

/**
 * Record a failed request for a source.
 * Increments the consecutive failure count and disables the source
 * after reaching the failure threshold (5 consecutive failures).
 */
export function recordFailure(source: string): void {
  const health = getOrCreateHealth(source);
  health.totalRequests += 1;
  health.totalFailures += 1;
  health.consecutiveFailures += 1;
  health.lastFailureAt = new Date();

  if (health.consecutiveFailures >= FAILURE_THRESHOLD && health.state !== 'disabled') {
    const cooldownMs = readCooldownMs();
    health.disabledUntil = new Date(Date.now() + cooldownMs);
    transitionState(health, 'disabled');

    console.log(
      `[HealthMonitor] Source "${source}" disabled until ${health.disabledUntil.toISOString()} ` +
        `(cooldown: ${cooldownMs / 1000 / 60} minutes)`,
    );
  }
}

/**
 * Check whether a source is available for requests.
 * Returns true if the source is healthy, degraded, or if the cooldown has expired.
 */
export function isSourceAvailable(source: string): boolean {
  const health = getOrCreateHealth(source);

  if (health.state === 'healthy' || health.state === 'degraded') {
    return true;
  }

  if (health.state === 'probing') {
    // While probing, source is not available for regular traffic
    return false;
  }

  // State is 'disabled' — check if cooldown has expired
  if (health.disabledUntil && Date.now() >= health.disabledUntil.getTime()) {
    return true;
  }

  return false;
}

/**
 * Probe a disabled source after cooldown expiry.
 * Sends a single probe request via the adapter. If the probe succeeds,
 * the source transitions back to healthy. If it fails, the cooldown resets.
 *
 * Returns true if the probe succeeded and the source is re-enabled.
 */
export async function probeSource(source: string, adapter: SourceAdapter): Promise<boolean> {
  const health = getOrCreateHealth(source);

  transitionState(health, 'probing');

  try {
    // Attempt a minimal probe — use enrich with a dummy context if available,
    // otherwise use discover with an empty query set
    if (adapter.enrich) {
      await adapter.enrich({ name: '__probe__', company: '__probe__' });
    } else if (adapter.discover) {
      await adapter.discover([], { targetRole: '', industry: '' } as never);
    }

    // Probe succeeded — reset to healthy
    health.consecutiveFailures = 0;
    health.disabledUntil = null;
    health.totalRequests += 1;
    transitionState(health, 'healthy');

    console.log(`[HealthMonitor] Probe succeeded for "${source}". Source re-enabled.`);
    return true;
  } catch {
    // Probe failed — reset cooldown
    health.totalRequests += 1;
    health.totalFailures += 1;
    health.lastFailureAt = new Date();

    const cooldownMs = readCooldownMs();
    health.disabledUntil = new Date(Date.now() + cooldownMs);
    transitionState(health, 'disabled');

    console.log(
      `[HealthMonitor] Probe failed for "${source}". ` +
        `Re-disabled until ${health.disabledUntil.toISOString()}`,
    );
    return false;
  }
}

/**
 * Get a health summary for all tracked sources.
 * Returns a record keyed by source name with full health details.
 */
export function getHealthSummary(): Record<string, SourceHealth> {
  const summary: Record<string, SourceHealth> = {};
  for (const [source, health] of healthMap) {
    summary[source] = { ...health };
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Testing Utilities (exported for test access only)
// ---------------------------------------------------------------------------

/** Reset all internal state. Useful for tests. */
export function _resetForTesting(): void {
  healthMap.clear();
}

/** Get the raw health entry for a source. */
export function _getHealth(source: string): SourceHealth | undefined {
  return healthMap.get(source);
}
