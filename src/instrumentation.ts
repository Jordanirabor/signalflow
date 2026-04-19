/**
 * Next.js instrumentation hook — runs once on server startup.
 * Used to start background schedulers.
 */
export async function register() {
  // Only run on the server (not during build or in edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { cleanupStuckPipelineRuns } = await import('@/services/pipelineOrchestratorService');
    const { startScheduler } = await import('@/services/pipelineSchedulerService');
    const { startImapPollScheduler } = await import('@/services/imapPollScheduler');

    // Clean up any pipeline runs stuck from a previous crash/restart
    const recovered = await cleanupStuckPipelineRuns();
    if (recovered > 0) {
      console.log(`[Instrumentation] Recovered ${recovered} stuck pipeline run(s)`);
    }

    startScheduler();
    startImapPollScheduler();

    console.log('[Instrumentation] Pipeline scheduler started');
    console.log('[Instrumentation] IMAP poll scheduler started');
  }
}
