import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { createProject, listProjects } from '@/services/icpProjectService';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/projects
 * List all non-deleted projects for the authenticated founder.
 *
 * Requirements: 2.5
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const projects = await listProjects(session.founderId);
    return NextResponse.json(projects);
  } catch {
    return dbWriteError('Failed to retrieve projects');
  }
}

/**
 * POST /api/projects
 * Create a new ICP project. Body: { name, productDescription }
 * founderId is derived from the server-side session.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5, 1.6
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { name?: string; productDescription?: string };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (!body.name || !body.productDescription) {
    return validationError('name and productDescription are required');
  }

  try {
    const project = await createProject(session.founderId, body.name, body.productDescription);
    return NextResponse.json(project, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create project';
    if (message.startsWith('Invalid project:') || message.includes('already exists')) {
      return validationError(message);
    }
    return dbWriteError(message);
  }
}
