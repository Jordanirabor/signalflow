import {
  _getHealth,
  _resetForTesting,
  getHealthSummary,
  isSourceAvailable,
  probeSource,
  recordFailure,
  recordSuccess,
} from '../healthMonitor';
import type { SourceAdapter } from '../types';

beforeEach(() => {
  _resetForTesting();
  delete process.env.SOURCE_HEALTH_COOLDOWN_MINUTES;
});

// ---------------------------------------------------------------------------
// recordSuccess
// ---------------------------------------------------------------------------

describe('recordSuccess', () => {
  it('initialises a healthy source on first call', () => {
    recordSuccess('google');
    const h = _getHealth('google')!;
    expect(h.state).toBe('healthy');
    expect(h.consecutiveFailures).toBe(0);
    expect(h.totalRequests).toBe(1);
  });

  it('resets consecutive failures to 0', () => {
    recordFailure('google');
    recordFailure('google');
    recordFailure('google');
    recordSuccess('google');
    const h = _getHealth('google')!;
    expect(h.consecutiveFailures).toBe(0);
    expect(h.state).toBe('healthy');
  });
});

// ---------------------------------------------------------------------------
// recordFailure
// ---------------------------------------------------------------------------

describe('recordFailure', () => {
  it('increments consecutive failure count', () => {
    recordFailure('linkedin');
    recordFailure('linkedin');
    const h = _getHealth('linkedin')!;
    expect(h.consecutiveFailures).toBe(2);
    expect(h.totalFailures).toBe(2);
  });

  it('disables source after 5 consecutive failures', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure('linkedin');
    }
    const h = _getHealth('linkedin')!;
    expect(h.state).toBe('disabled');
    expect(h.disabledUntil).not.toBeNull();
    expect(h.consecutiveFailures).toBe(5);
  });

  it('does not disable source before 5 failures', () => {
    for (let i = 0; i < 4; i++) {
      recordFailure('github');
    }
    const h = _getHealth('github')!;
    expect(h.state).toBe('healthy');
  });

  it('a single success between failures resets the count', () => {
    for (let i = 0; i < 4; i++) {
      recordFailure('twitter');
    }
    recordSuccess('twitter');
    recordFailure('twitter');
    const h = _getHealth('twitter')!;
    expect(h.consecutiveFailures).toBe(1);
    expect(h.state).toBe('healthy');
  });
});

// ---------------------------------------------------------------------------
// isSourceAvailable
// ---------------------------------------------------------------------------

describe('isSourceAvailable', () => {
  it('returns true for unknown (new) sources', () => {
    expect(isSourceAvailable('new_source')).toBe(true);
  });

  it('returns true for healthy sources', () => {
    recordSuccess('google');
    expect(isSourceAvailable('google')).toBe(true);
  });

  it('returns false for disabled sources within cooldown', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure('google');
    }
    expect(isSourceAvailable('google')).toBe(false);
  });

  it('returns true for disabled sources after cooldown expires', () => {
    process.env.SOURCE_HEALTH_COOLDOWN_MINUTES = '0.001'; // ~60ms
    for (let i = 0; i < 5; i++) {
      recordFailure('google');
    }
    // Manually set disabledUntil to the past
    const h = _getHealth('google')!;
    h.disabledUntil = new Date(Date.now() - 1000);
    expect(isSourceAvailable('google')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// probeSource
// ---------------------------------------------------------------------------

describe('probeSource', () => {
  const makeAdapter = (shouldFail: boolean): SourceAdapter => ({
    name: 'test_adapter',
    capabilities: ['enrichment'],
    isEnabled: () => true,
    enrich: shouldFail
      ? async () => {
          throw new Error('probe failed');
        }
      : async () => ({}),
  });

  it('transitions to healthy on successful probe', async () => {
    for (let i = 0; i < 5; i++) {
      recordFailure('test');
    }
    const h = _getHealth('test')!;
    h.disabledUntil = new Date(Date.now() - 1000);

    const result = await probeSource('test', makeAdapter(false));
    expect(result).toBe(true);
    expect(_getHealth('test')!.state).toBe('healthy');
    expect(_getHealth('test')!.consecutiveFailures).toBe(0);
  });

  it('re-disables on failed probe', async () => {
    for (let i = 0; i < 5; i++) {
      recordFailure('test');
    }
    const h = _getHealth('test')!;
    h.disabledUntil = new Date(Date.now() - 1000);

    const result = await probeSource('test', makeAdapter(true));
    expect(result).toBe(false);
    expect(_getHealth('test')!.state).toBe('disabled');
    expect(_getHealth('test')!.disabledUntil).not.toBeNull();
  });

  it('uses discover when enrich is not available', async () => {
    const adapter: SourceAdapter = {
      name: 'discovery_only',
      capabilities: ['discovery'],
      isEnabled: () => true,
      discover: async () => [],
    };

    for (let i = 0; i < 5; i++) {
      recordFailure('disc');
    }
    const h = _getHealth('disc')!;
    h.disabledUntil = new Date(Date.now() - 1000);

    const result = await probeSource('disc', adapter);
    expect(result).toBe(true);
    expect(_getHealth('disc')!.state).toBe('healthy');
  });
});

// ---------------------------------------------------------------------------
// getHealthSummary
// ---------------------------------------------------------------------------

describe('getHealthSummary', () => {
  it('returns empty object when no sources tracked', () => {
    expect(getHealthSummary()).toEqual({});
  });

  it('returns health for all tracked sources', () => {
    recordSuccess('google');
    recordFailure('linkedin');
    const summary = getHealthSummary();
    expect(Object.keys(summary)).toEqual(['google', 'linkedin']);
    expect(summary.google.state).toBe('healthy');
    expect(summary.linkedin.consecutiveFailures).toBe(1);
  });

  it('reports disabled status correctly', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure('github');
    }
    const summary = getHealthSummary();
    expect(summary.github.state).toBe('disabled');
  });
});

// ---------------------------------------------------------------------------
// Configurable cooldown
// ---------------------------------------------------------------------------

describe('configurable cooldown', () => {
  it('uses env var for cooldown duration', () => {
    process.env.SOURCE_HEALTH_COOLDOWN_MINUTES = '30';
    for (let i = 0; i < 5; i++) {
      recordFailure('smtp');
    }
    const h = _getHealth('smtp')!;
    // disabledUntil should be ~30 minutes from now
    const expectedMin = Date.now() + 29 * 60 * 1000;
    const expectedMax = Date.now() + 31 * 60 * 1000;
    expect(h.disabledUntil!.getTime()).toBeGreaterThan(expectedMin);
    expect(h.disabledUntil!.getTime()).toBeLessThan(expectedMax);
  });
});
