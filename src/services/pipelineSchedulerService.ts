import { getActiveProjects } from '@/services/icpProjectService';
import { getPipelineConfig } from '@/services/pipelineConfigService';
import { computeNextRunTime, executePipelineRun } from '@/services/pipelineOrchestratorService';
import * as cron from 'node-cron';

// ---------------------------------------------------------------------------
// Scheduler state
// ---------------------------------------------------------------------------

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

/**
 * Fetch all founder IDs that have pipeline_state = 'running'.
 */
async function getActiveFounderIds(): Promise<string[]> {
  const { query: dbQuery } = await import('@/lib/db');
  const result = await dbQuery<{ founder_id: string }>(
    `SELECT founder_id FROM pipeline_config WHERE pipeline_state = 'running'`,
  );
  return result.rows.map((r) => r.founder_id);
}

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

    try {
      isRunning = true;
      const founderIds = await getActiveFounderIds();

      for (const founderId of founderIds) {
        try {
          const config = await getPipelineConfig(founderId);
          const now = new Date();

          // Check if current time is within business hours on a business day
          const [startHour, startMinute] = config.businessHoursStart.split(':').map(Number);
          const [endHour, endMinute] = config.businessHoursEnd.split(':').map(Number);
          const bhStart = startHour * 60 + startMinute;
          const bhEnd = endHour * 60 + endMinute;
          const currentMinutes = now.getHours() * 60 + now.getMinutes();

          if (!config.businessDays.includes(now.getDay())) continue;
          if (currentMinutes < bhStart || currentMinutes >= bhEnd) continue;

          // Check if enough time has passed since last run
          const { query: dbQuery } = await import('@/lib/db');
          const lastRunResult = await dbQuery<{ completed_at: Date }>(
            `SELECT completed_at FROM pipeline_run
             WHERE founder_id = $1 AND completed_at IS NOT NULL
             ORDER BY completed_at DESC LIMIT 1`,
            [founderId],
          );

          if (lastRunResult.rows.length > 0) {
            const lastCompleted = new Date(lastRunResult.rows[0].completed_at);
            const nextRun = computeNextRunTime(config, lastCompleted);
            if (now < nextRun) continue; // Not time yet
          }

          // Execute the pipeline run for each active project
          const activeProjects = await getActiveProjects(founderId);
          for (const project of activeProjects) {
            await executePipelineRun(founderId, project.id);
          }
        } catch (err) {
          console.error(`[PipelineScheduler] Error for founder ${founderId}:`, err);
        }
      }
    } catch (err) {
      console.error('[PipelineScheduler] Error fetching active founders:', err);
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
