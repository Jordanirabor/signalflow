// ============================================================
// Source Configuration — Environment-based config loading & validation
// ============================================================

import type { SourceConfig } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readEnvBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultValue;
  return raw.toLowerCase() === 'true';
}

function readEnvInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function readEnvString(key: string): string | undefined {
  const raw = process.env[key];
  return raw && raw.length > 0 ? raw : undefined;
}

// ---------------------------------------------------------------------------
// loadSourceConfig
// ---------------------------------------------------------------------------

/**
 * Loads the full SourceConfig from environment variables.
 * Proprietary sources default to enabled; premium adapters default to disabled.
 */
export function loadSourceConfig(): SourceConfig {
  // Proprietary source flags (default: true)
  const googleSearchEnabled = readEnvBool('GOOGLE_SEARCH_ENABLED', true);
  const linkedinScrapingEnabled = readEnvBool('LINKEDIN_SCRAPING_ENABLED', true);
  const githubScrapingEnabled = readEnvBool('GITHUB_SCRAPING_ENABLED', true);
  const twitterScrapingEnabled = readEnvBool('TWITTER_SCRAPING_ENABLED', true);
  const directoryScrapingEnabled = readEnvBool('DIRECTORY_SCRAPING_ENABLED', true);
  const mapsScrapingEnabled = readEnvBool('MAPS_SCRAPING_ENABLED', true);
  const smtpVerificationEnabled = readEnvBool('SMTP_VERIFICATION_ENABLED', true);

  // Premium adapter flags (default: false)
  const apolloEnabled = readEnvBool('APOLLO_ENABLED', false);
  const hunterEnabled = readEnvBool('HUNTER_ENABLED', false);
  const clearbitEnabled = readEnvBool('CLEARBIT_ENABLED', false);

  // Premium API keys
  const apolloApiKey = readEnvString('APOLLO_API_KEY');
  const hunterApiKey = readEnvString('HUNTER_API_KEY');
  const clearbitApiKey = readEnvString('CLEARBIT_API_KEY');

  // Proxy configuration
  const proxyEnabled = readEnvBool('SCRAPING_PROXY_ENABLED', false);
  const proxyListRaw = process.env.SCRAPING_PROXY_LIST ?? '';
  const proxyList = proxyListRaw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Rate limit overrides (per minute)
  const googleRateLimit = readEnvInt('GOOGLE_RATE_LIMIT', 10);
  const linkedinRateLimit = readEnvInt('LINKEDIN_RATE_LIMIT', 5);
  const githubRateLimit = readEnvInt('GITHUB_RATE_LIMIT', 15);
  const twitterRateLimit = readEnvInt('TWITTER_RATE_LIMIT', 5);
  const smtpRateLimit = readEnvInt('SMTP_RATE_LIMIT', 20);

  // Daily budget
  const dailyBudgetPerSource = readEnvInt('DAILY_BUDGET_PER_SOURCE', 500);

  return {
    googleSearchEnabled,
    linkedinScrapingEnabled,
    githubScrapingEnabled,
    twitterScrapingEnabled,
    directoryScrapingEnabled,
    mapsScrapingEnabled,
    smtpVerificationEnabled,
    apolloEnabled,
    apolloApiKey,
    hunterEnabled,
    hunterApiKey,
    clearbitEnabled,
    clearbitApiKey,
    proxyEnabled,
    proxyList,
    googleRateLimit,
    linkedinRateLimit,
    githubRateLimit,
    twitterRateLimit,
    smtpRateLimit,
    dailyBudgetPerSource,
  };
}

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------

/**
 * Validates the loaded SourceConfig and logs warnings for misconfigured
 * or missing optional settings. Call on startup.
 */
export function validateConfig(config: SourceConfig): void {
  const warnings: string[] = [];

  // Premium adapters enabled without API keys
  if (config.apolloEnabled && !config.apolloApiKey) {
    warnings.push('APOLLO_ENABLED is true but APOLLO_API_KEY is not set — adapter will not work');
  }
  if (config.hunterEnabled && !config.hunterApiKey) {
    warnings.push('HUNTER_ENABLED is true but HUNTER_API_KEY is not set — adapter will not work');
  }
  if (config.clearbitEnabled && !config.clearbitApiKey) {
    warnings.push(
      'CLEARBIT_ENABLED is true but CLEARBIT_API_KEY is not set — adapter will not work',
    );
  }

  // Proxy enabled but no proxies configured
  if (config.proxyEnabled && config.proxyList.length === 0) {
    warnings.push(
      'SCRAPING_PROXY_ENABLED is true but SCRAPING_PROXY_LIST is empty — requests will not be proxied',
    );
  }

  // All proprietary sources disabled
  const anyProprietaryEnabled =
    config.googleSearchEnabled ||
    config.linkedinScrapingEnabled ||
    config.githubScrapingEnabled ||
    config.twitterScrapingEnabled ||
    config.directoryScrapingEnabled ||
    config.mapsScrapingEnabled;

  const anyPremiumEnabled = config.apolloEnabled || config.hunterEnabled || config.clearbitEnabled;

  if (!anyProprietaryEnabled && !anyPremiumEnabled) {
    console.error('[SourceConfig] No data sources available for discovery');
  }

  // Rate limit sanity checks
  if (config.googleRateLimit <= 0) {
    warnings.push(`GOOGLE_RATE_LIMIT is ${config.googleRateLimit} — should be a positive integer`);
  }
  if (config.linkedinRateLimit <= 0) {
    warnings.push(
      `LINKEDIN_RATE_LIMIT is ${config.linkedinRateLimit} — should be a positive integer`,
    );
  }
  if (config.githubRateLimit <= 0) {
    warnings.push(`GITHUB_RATE_LIMIT is ${config.githubRateLimit} — should be a positive integer`);
  }
  if (config.twitterRateLimit <= 0) {
    warnings.push(
      `TWITTER_RATE_LIMIT is ${config.twitterRateLimit} — should be a positive integer`,
    );
  }
  if (config.smtpRateLimit <= 0) {
    warnings.push(`SMTP_RATE_LIMIT is ${config.smtpRateLimit} — should be a positive integer`);
  }
  if (config.dailyBudgetPerSource <= 0) {
    warnings.push(
      `DAILY_BUDGET_PER_SOURCE is ${config.dailyBudgetPerSource} — should be a positive integer`,
    );
  }

  // Log all warnings
  for (const warning of warnings) {
    console.warn(`[SourceConfig] ${warning}`);
  }

  if (warnings.length === 0) {
    console.log('[SourceConfig] Configuration validated successfully');
  }
}
