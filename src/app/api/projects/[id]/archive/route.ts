import { dbWriteError, validationError } from '@/lib/apiErrors';
import { getSession } from '@/lib/auth';
import { archiveProject, getProjectById } from '@/services/icpProjectService';
import { NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/archive
 * Archive a project by setting is_active = false.
 *
 * Requirements: 2.2, 2.4
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    // Verify ownership before archiving
    const existing = await getProjectById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (existing.founderId !== session.founderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const project = await archiveProject(id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    return NextResponse.json(project);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to archive project';
    if (message.includes('Cannot archive the last active project')) {
      return validationError(message);
    }
    return dbWriteError(message);
  }
}
