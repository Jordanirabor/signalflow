import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSourceConfig, validateConfig } from './sourceConfig';

describe('loadSourceConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns all proprietary sources enabled by default', () => {
    const config = loadSourceConfig();
    expect(config.googleSearchEnabled).toBe(true);
    expect(config.linkedinScrapingEnabled).toBe(true);
    expect(config.githubScrapingEnabled).toBe(true);
    expect(config.twitterScrapingEnabled).toBe(true);
    expect(config.directoryScrapingEnabled).toBe(true);
    expect(config.mapsScrapingEnabled).toBe(true);
    expect(config.smtpVerificationEnabled).toBe(true);
  });

  it('returns all premium adapters disabled by default', () => {
    const config = loadSourceConfig();
    expect(config.apolloEnabled).toBe(false);
    expect(config.hunterEnabled).toBe(false);
    expect(config.clearbitEnabled).toBe(false);
  });

  it('reads proprietary source flags from env vars', () => {
    process.env.GOOGLE_SEARCH_ENABLED = 'false';
    process.env.GITHUB_SCRAPING_ENABLED = 'false';
    const config = loadSourceConfig();
    expect(config.googleSearchEnabled).toBe(false);
    expect(config.githubScrapingEnabled).toBe(false);
    expect(config.linkedinScrapingEnabled).toBe(true);
  });

  it('reads premium flags and API keys from env vars', () => {
    process.env.APOLLO_ENABLED = 'true';
    process.env.APOLLO_API_KEY = 'ak_test123';
    process.env.HUNTER_ENABLED = 'TRUE';
    process.env.HUNTER_API_KEY = 'hk_test456';
    const config = loadSourceConfig();
    expect(config.apolloEnabled).toBe(true);
    expect(config.apolloApiKey).toBe('ak_test123');
    expect(config.hunterEnabled).toBe(true);
    expect(config.hunterApiKey).toBe('hk_test456');
    expect(config.clearbitEnabled).toBe(false);
    expect(config.clearbitApiKey).toBeUndefined();
  });

  it('reads proxy configuration from env vars', () => {
    process.env.SCRAPING_PROXY_ENABLED = 'true';
    process.env.SCRAPING_PROXY_LIST = 'http://proxy1:8080, http://proxy2:8080, http://proxy3:8080';
    const config = loadSourceConfig();
    expect(config.proxyEnabled).toBe(true);
    expect(config.proxyList).toEqual([
      'http://proxy1:8080',
      'http://proxy2:8080',
      'http://proxy3:8080',
    ]);
  });

  it('returns empty proxy list when env var is not set', () => {
    const config = loadSourceConfig();
    expect(config.proxyEnabled).toBe(false);
    expect(config.proxyList).toEqual([]);
  });

  it('reads rate limit overrides from env vars', () => {
    process.env.GOOGLE_RATE_LIMIT = '20';
    process.env.LINKEDIN_RATE_LIMIT = '3';
    process.env.SMTP_RATE_LIMIT = '50';
    const config = loadSourceConfig();
    expect(config.googleRateLimit).toBe(20);
    expect(config.linkedinRateLimit).toBe(3);
    expect(config.githubRateLimit).toBe(15); // default
    expect(config.twitterRateLimit).toBe(5); // default
    expect(config.smtpRateLimit).toBe(50);
  });

  it('uses defaults for non-numeric rate limit values', () => {
    process.env.GOOGLE_RATE_LIMIT = 'abc';
    const config = loadSourceConfig();
    expect(config.googleRateLimit).toBe(10);
  });

  it('reads daily budget override from env var', () => {
    process.env.DAILY_BUDGET_PER_SOURCE = '1000';
    const config = loadSourceConfig();
    expect(config.dailyBudgetPerSource).toBe(1000);
  });

  it('uses default daily budget of 500', () => {
    const config = loadSourceConfig();
    expect(config.dailyBudgetPerSource).toBe(500);
  });

  it('filters empty entries from proxy list', () => {
    process.env.SCRAPING_PROXY_LIST = 'http://proxy1:8080,,  , http://proxy2:8080';
    const config = loadSourceConfig();
    expect(config.proxyList).toEqual(['http://proxy1:8080', 'http://proxy2:8080']);
  });
});

describe('validateConfig', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  function defaultConfig(): import('./types').SourceConfig {
    return {
      googleSearchEnabled: true,
      linkedinScrapingEnabled: true,
      githubScrapingEnabled: true,
      twitterScrapingEnabled: true,
      directoryScrapingEnabled: true,
      mapsScrapingEnabled: true,
      smtpVerificationEnabled: true,
      apolloEnabled: false,
      hunterEnabled: false,
      clearbitEnabled: false,
      proxyEnabled: false,
      proxyList: [],
      googleRateLimit: 10,
      linkedinRateLimit: 5,
      githubRateLimit: 15,
      twitterRateLimit: 5,
      smtpRateLimit: 20,
      dailyBudgetPerSource: 500,
    };
  }

  it('logs success when config is valid', () => {
    validateConfig(defaultConfig());
    expect(logSpy).toHaveBeenCalledWith('[SourceConfig] Configuration validated successfully');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns when premium adapter enabled without API key', () => {
    validateConfig({ ...defaultConfig(), apolloEnabled: true });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('APOLLO_ENABLED is true but APOLLO_API_KEY is not set'),
    );
  });

  it('warns when proxy enabled but list is empty', () => {
    validateConfig({ ...defaultConfig(), proxyEnabled: true, proxyList: [] });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('SCRAPING_PROXY_ENABLED is true but SCRAPING_PROXY_LIST is empty'),
    );
  });

  it('logs error when all sources are disabled', () => {
    validateConfig({
      ...defaultConfig(),
      googleSearchEnabled: false,
      linkedinScrapingEnabled: false,
      githubScrapingEnabled: false,
      twitterScrapingEnabled: false,
      directoryScrapingEnabled: false,
      mapsScrapingEnabled: false,
    });
    expect(errorSpy).toHaveBeenCalledWith('[SourceConfig] No data sources available for discovery');
  });

  it('warns on non-positive rate limits', () => {
    validateConfig({ ...defaultConfig(), googleRateLimit: 0, smtpRateLimit: -1 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('GOOGLE_RATE_LIMIT is 0'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SMTP_RATE_LIMIT is -1'));
  });

  it('does not warn when premium adapter has API key', () => {
    validateConfig({ ...defaultConfig(), apolloEnabled: true, apolloApiKey: 'key123' });
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('APOLLO_ENABLED'));
  });
});
