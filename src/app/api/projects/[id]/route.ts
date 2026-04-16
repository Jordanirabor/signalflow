import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { getProjectById, softDeleteProject, updateProject } from '@/services/icpProjectService';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id
 * Return a single project by ID.
 *
 * Requirements: 2.5
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const project = await getProjectById(id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (project.founderId !== session.founderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    return NextResponse.json(project);
  } catch {
    return dbWriteError('Failed to retrieve project');
  }
}

/**
 * PATCH /api/projects/:id
 * Update project name and/or product description.
 *
 * Requirements: 2.1
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  let body: { name?: string; productDescription?: string };
  try {
    body = await request.json();
  } catch {
    return validationError('Invalid JSON body');
  }

  if (!body.name && !body.productDescription) {
    return validationError('At least one of name or productDescription is required');
  }

  try {
    // Verify ownership before updating
    const existing = await getProjectById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (existing.founderId !== session.founderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const project = await updateProject(id, body);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    return NextResponse.json(project);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update project';
    if (message.startsWith('Invalid project:') || message.includes('already exists')) {
      return validationError(message);
    }
    return dbWriteError(message);
  }
}

/**
 * DELETE /api/projects/:id
 * Soft-delete a project. Retains all associated leads and historical data.
 *
 * Requirements: 2.3, 2.4
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    // Verify ownership before deleting
    const existing = await getProjectById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (existing.founderId !== session.founderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const project = await softDeleteProject(id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete project';
    if (message.includes('Cannot delete the last active project')) {
      return validationError(message);
    }
    return dbWriteError(message);
  }
}
