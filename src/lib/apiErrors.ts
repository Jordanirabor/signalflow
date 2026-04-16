import type { ApiError } from '@/types';
import { NextResponse } from 'next/server';

/**
 * Create a NextResponse with an ApiError JSON body and the given HTTP status.
 */
function errorResponse(
  status: number,
  error: string,
  message: string,
  details?: Record<string, string>,
): NextResponse<ApiError> {
  const body: ApiError = { error, message };
  if (details) {
    body.details = details;
  }
  return NextResponse.json(body, { status });
}

/** 400 — generic validation error */
export function validationError(
  message: string,
  details?: Record<string, string>,
): NextResponse<ApiError> {
  return errorResponse(400, 'VALIDATION_ERROR', message, details);
}

/** 409 — duplicate lead detected */
export function duplicateError(
  message: string,
  details?: Record<string, string>,
): NextResponse<ApiError> {
  return errorResponse(409, 'DUPLICATE_LEAD', message, details);
}

/** 429 — daily throttle limit exceeded */
export function throttleError(
  message: string,
  details?: Record<string, string>,
): NextResponse<ApiError> {
  return errorResponse(429, 'THROTTLE_EXCEEDED', message, details);
}

/** 500 — database write failure */
export function dbWriteError(message: string): NextResponse<ApiError> {
  return errorResponse(500, 'DB_WRITE_ERROR', message);
}

/** 400 — backward CRM move missing reason */
export function reasonRequiredError(message: string): NextResponse<ApiError> {
  return errorResponse(400, 'REASON_REQUIRED', message);
}

/** 400 — Booked status missing meeting date */
export function meetingDateRequiredError(message: string): NextResponse<ApiError> {
  return errorResponse(400, 'MEETING_DATE_REQUIRED', message);
}
