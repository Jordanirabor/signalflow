import { getProjectById } from '@/services/icpProjectService';
import { getPipelineConfig, savePipelineConfig } from '@/services/pipelineConfigService';
import type { OutreachStrategy, PipelineConfig } from '@/types';

/**
 * Extract the outreach strategy fields from a PipelineConfig.
 */
export function extractStrategy(config: PipelineConfig): OutreachStrategy {
  return {
    productContext: config.productContext,
    valueProposition: config.valueProposition,
    targetPainPoints: config.targetPainPoints,
    tonePreference: config.tonePreference,
  };
}

/**
 * Get the outreach strategy for a founder.
 * When strategyScope is 'per_project' and a projectId is provided, loads
 * strategy fields from the project record. Falls back to global strategy
 * if the project is not found or strategyScope is 'global'.
 */
export async function getOutreachStrategy(
  founderId: string,
  projectId?: string,
): Promise<OutreachStrategy> {
  const config = await getPipelineConfig(founderId);
  if (config.strategyScope === 'per_project' && projectId) {
    const project = await getProjectById(projectId);
    if (project) {
      return {
        productContext: project.productDescription,
        valueProposition: project.valueProposition,
        targetPainPoints: project.targetPainPoints,
        tonePreference: config.tonePreference,
      };
    }
  }
  return extractStrategy(config);
}

/**
 * Update the outreach strategy for a founder.
 * Merges the provided strategy fields into the existing pipeline config and saves.
 */
export async function updateOutreachStrategy(
  founderId: string,
  strategy: Partial<OutreachStrategy>,
): Promise<OutreachStrategy> {
  const config = await getPipelineConfig(founderId);

  const updated: PipelineConfig = {
    ...config,
    ...(strategy.productContext !== undefined && { productContext: strategy.productContext }),
    ...(strategy.valueProposition !== undefined && { valueProposition: strategy.valueProposition }),
    ...(strategy.targetPainPoints !== undefined && { targetPainPoints: strategy.targetPainPoints }),
    ...(strategy.tonePreference !== undefined && { tonePreference: strategy.tonePreference }),
  };

  const saved = await savePipelineConfig(updated);
  return extractStrategy(saved);
}

/**
 * Format an outreach strategy into a prompt string for message generation.
 * Returns a structured text block that can be injected into the LLM prompt.
 */
export function formatStrategyForPrompt(strategy: OutreachStrategy): string {
  const lines: string[] = [];

  lines.push(`Product Context: ${strategy.productContext}`);
  lines.push(`Value Proposition: ${strategy.valueProposition}`);

  if (strategy.targetPainPoints.length > 0) {
    lines.push(`Target Pain Points: ${strategy.targetPainPoints.join('; ')}`);
  } else {
    lines.push('Target Pain Points: (none specified)');
  }

  lines.push(`Tone: ${strategy.tonePreference}`);

  return lines.join('\n');
}
