import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import {
  getPipelineConfig,
  savePipelineConfig,
  validatePipelineConfig,
} from '@/services/pipelineConfigService';
import type { PipelineConfig } from '@/types';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/config
 * Returns the current pipeline configuration (or defaults).
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const config = await getPipelineConfig(session.founderId);
    return NextResponse.json(config);
  } catch {
    return dbWriteError('Failed to retrieve pipeline config');
  }
}

/**
 * PUT /api/pipeline/config
 * Update pipeline configuration. Validates numeric ranges.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Partial<PipelineConfig>;
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  // Validate globalSteering length
  if (
    body.globalSteering !== undefined &&
    typeof body.globalSteering === 'string' &&
    body.globalSteering.length > 2000
  ) {
    return validationError('globalSteering must be 2000 characters or fewer');
  }

  // Validate strategyScope value
  if (
    body.strategyScope !== undefined &&
    body.strategyScope !== 'global' &&
    body.strategyScope !== 'per_project'
  ) {
    return validationError('strategyScope must be "global" or "per_project"');
  }

  const validation = validatePipelineConfig(body);
  if (!validation.valid) {
    return validationError('Pipeline configuration values out of allowed range', validation.errors);
  }

  const founderId = session.founderId;

  try {
    // Get current config to fill in defaults for unspecified fields
    const current = await getPipelineConfig(founderId);

    const merged: PipelineConfig = {
      founderId,
      runIntervalMinutes: body.runIntervalMinutes ?? current.runIntervalMinutes,
      businessHoursStart: body.businessHoursStart ?? current.businessHoursStart,
      businessHoursEnd: body.businessHoursEnd ?? current.businessHoursEnd,
      businessDays: body.businessDays ?? current.businessDays,
      timezone: body.timezone ?? current.timezone,
      dailyDiscoveryCap: body.dailyDiscoveryCap ?? current.dailyDiscoveryCap,
      minLeadScore: body.minLeadScore ?? current.minLeadScore,
      maxFollowUps: body.maxFollowUps ?? current.maxFollowUps,
      sequenceCadenceDays: body.sequenceCadenceDays ?? current.sequenceCadenceDays,
      tonePreference: body.tonePreference ?? current.tonePreference,
      productContext: body.productContext ?? current.productContext,
      valueProposition: body.valueProposition ?? current.valueProposition,
      targetPainPoints: body.targetPainPoints ?? current.targetPainPoints,
      globalSteering: body.globalSteering ?? current.globalSteering,
      strategyScope: body.strategyScope ?? current.strategyScope,
    };

    const config = await savePipelineConfig(merged);
    return NextResponse.json(config);
  } catch {
    return dbWriteError('Failed to update pipeline config');
  }
}
