import { getActiveProjects } from '@/services/icpProjectService';
import { getPipelineConfig } from '@/services/pipelineConfigService';
import {
  computeNextRunTime,
  executePipelineRun,
  getPipelineState,
} from '@/services/pipelineOrchestratorService';
import * as cron from 'node-cron';

// ---------------------------------------------------------------------------
// Scheduler state
// ---------------------------------------------------------------------------

/**
 * TODO: The pipeline scheduler currently uses a hardcoded founder ID.
 * This should be refactored to iterate over all active founders or accept
 * a founderId parameter once multi-tenant scheduling is implemented.
 */
const FOUNDER_ID = '00000000-0000-0000-0000-000000000001';

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

/**
 * Start the pipeline scheduler.
 * Uses node-cron to check every minute whether a pipeline run should execute.
 * The actual run timing is governed by the pipeline config (interval, business hours).
 */
export function startScheduler(): void {
  if (cronTask) return; // Already started

  // Check every minute if we should trigger a run
  cronTask = cron.schedule('* * * * *', async () => {
    if (isRunning) return; // Skip if a run is already in progress

    const pipelineState = await getPipelineState(FOUNDER_ID);
    if (pipelineState !== 'running') return; // Only run when pipeline is active

    try {
      const config = await getPipelineConfig(FOUNDER_ID);
      const now = new Date();

      // Check if current time is within business hours on a business day
      const [startHour, startMinute] = config.businessHoursStart.split(':').map(Number);
      const [endHour, endMinute] = config.businessHoursEnd.split(':').map(Number);
      const bhStart = startHour * 60 + startMinute;
      const bhEnd = endHour * 60 + endMinute;
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      if (!config.businessDays.includes(now.getDay())) return;
      if (currentMinutes < bhStart || currentMinutes >= bhEnd) return;

      // Check if enough time has passed since last run
      const { query: dbQuery } = await import('@/lib/db');
      const lastRunResult = await dbQuery<{ completed_at: Date }>(
        `SELECT completed_at FROM pipeline_run
         WHERE founder_id = $1 AND completed_at IS NOT NULL
         ORDER BY completed_at DESC LIMIT 1`,
        [FOUNDER_ID],
      );

      if (lastRunResult.rows.length > 0) {
        const lastCompleted = new Date(lastRunResult.rows[0].completed_at);
        const nextRun = computeNextRunTime(config, lastCompleted);
        if (now < nextRun) return; // Not time yet
      }

      // Execute the pipeline run for each active project
      isRunning = true;
      const activeProjects = await getActiveProjects(FOUNDER_ID);
      for (const project of activeProjects) {
        await executePipelineRun(FOUNDER_ID, project.id);
      }
    } catch (err) {
      console.error('[PipelineScheduler] Error during scheduled run:', err);
    } finally {
      isRunning = false;
    }
  });
}

/**
 * Stop the pipeline scheduler.
 */
export function stopScheduler(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}

/**
 * Check if the scheduler is currently active.
 */
export function isSchedulerActive(): boolean {
  return cronTask !== null;
}
