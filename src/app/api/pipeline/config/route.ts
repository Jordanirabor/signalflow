import { dbWriteError, validationError } from '@/lib/apiErrors';
import {
  getPipelineConfig,
  savePipelineConfig,
  validatePipelineConfig,
} from '@/services/pipelineConfigService';
import type { PipelineConfig } from '@/types';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/pipeline/config?founderId=<uuid>
 * Returns the current pipeline configuration (or defaults).
 */
export async function GET(request: NextRequest) {
  const founderId = request.nextUrl.searchParams.get('founderId');
  if (!founderId) {
    return validationError('founderId query parameter is required', { founderId: 'missing' });
  }

  try {
    const config = await getPipelineConfig(founderId);
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
  let body: Partial<PipelineConfig> & { founderId?: string };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (!body.founderId) {
    return validationError('founderId is required', { founderId: 'missing' });
  }

  const validation = validatePipelineConfig(body);
  if (!validation.valid) {
    return validationError('Pipeline configuration values out of allowed range', validation.errors);
  }

  try {
    // Get current config to fill in defaults for unspecified fields
    const current = await getPipelineConfig(body.founderId);

    const merged: PipelineConfig = {
      founderId: body.founderId,
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
    };

    const config = await savePipelineConfig(merged);
    return NextResponse.json(config);
  } catch {
    return dbWriteError('Failed to update pipeline config');
  }
}
