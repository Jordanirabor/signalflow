// ============================================================
// Structured Logger — Discovery Engine Observability
// ============================================================

import type { StructuredLogEntry } from './types';

// ---------------------------------------------------------------------------
// Summary Interfaces
// ---------------------------------------------------------------------------

export interface DiscoverySummary {
  totalQueries: number;
  resultsPerSource: Record<string, number>;
  leadsExtracted: number;
  leadsFiltered: number;
  filterReasons: Record<string, number>;
  leadsDeduplicated: number;
}

export interface EnrichmentSummary {
  sourcesAttempted: string[];
  sourcesSucceeded: string[];
  sourcesFailed: Record<string, string>;
  emailResult: string;
  confidenceScore: number;
}

export interface PipelineRunSummary {
  prospectsDiscovered: number;
  enrichmentsCompleted: number;
  enrichmentsRetried: number;
  messagesSent: number;
  messagesFailed: number;
  repliesProcessed: number;
  meetingsBooked: number;
}

// ---------------------------------------------------------------------------
// Logging Functions
// ---------------------------------------------------------------------------

/**
 * Write a structured log entry as JSON to the console.
 */
export function logStructured(entry: StructuredLogEntry): void {
  console.log(JSON.stringify(entry));
}

/**
 * Log a discovery run summary with aggregate metrics.
 */
export function logDiscoverySummary(summary: DiscoverySummary): void {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    stage: 'discovery',
    level: 'info',
    message: 'Discovery run completed',
    metadata: { ...summary },
  };
  console.log(JSON.stringify(entry));
}

/**
 * Log an enrichment summary for a specific lead.
 */
export function logEnrichmentSummary(leadId: string, summary: EnrichmentSummary): void {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    stage: 'enrichment',
    level: 'info',
    message: 'Enrichment completed',
    leadId,
    metadata: { ...summary },
  };
  console.log(JSON.stringify(entry));
}

/**
 * Log a pipeline run summary with all aggregate metrics.
 */
export function logPipelineRunSummary(runId: string, summary: PipelineRunSummary): void {
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    stage: 'pipeline',
    level: 'info',
    message: 'Pipeline run completed',
    metadata: { runId, ...summary },
  };
  console.log(JSON.stringify(entry));
}
