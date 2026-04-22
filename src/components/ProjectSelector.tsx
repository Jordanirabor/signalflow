'use client';

import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProject } from '@/contexts/ProjectContext';
import { ICPProject } from '@/types';
import { FolderPlus } from 'lucide-react';
import { useEffect, useState } from 'react';

const NEW_PROJECT_VALUE = '__new_project__';

interface ProfileCounts {
  [projectId: string]: number;
}

export function ProjectSelector() {
  const { projects, selectedProjectId, setSelectedProject, isLoading } = useProject();
  const [profileCounts, setProfileCounts] = useState<ProfileCounts>({});

  // Fetch active profile counts per project
  useEffect(() => {
    let cancelled = false;

    async function fetchCounts() {
      const counts: ProfileCounts = {};
      await Promise.all(
        projects.map(async (project: ICPProject) => {
          try {
            const res = await fetch(`/api/icp/profiles?projectId=${project.id}`);
            if (res.ok) {
              const data = await res.json();
              counts[project.id] = data.activeCount ?? 0;
            }
          } catch {
            counts[project.id] = 0;
          }
        }),
      );
      if (!cancelled) {
        setProfileCounts(counts);
      }
    }

    if (projects.length > 0) {
      fetchCounts();
    }

    return () => {
      cancelled = true;
    };
  }, [projects]);

  const handleValueChange = (value: string) => {
    if (value === NEW_PROJECT_VALUE) {
      // Clear selection so ICPForm creates a new project on confirm
      setSelectedProject(null);
      window.location.href = '/icp';
      return;
    }
    setSelectedProject(value);
  };

  if (isLoading) {
    return <div className="h-9 w-[200px] animate-pulse rounded-md bg-muted" />;
  }

  if (projects.length === 0) {
    return null;
  }

  return (
    <Select value={selectedProjectId ?? undefined} onValueChange={handleValueChange}>
      <SelectTrigger className="w-[220px]" aria-label="Select project">
        <SelectValue placeholder="Select a project" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            <span className="flex items-center gap-2">
              <span className="truncate">{project.name}</span>
              <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">
                {profileCounts[project.id] ?? 0}
              </Badge>
            </span>
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={NEW_PROJECT_VALUE}>
          <span className="flex items-center gap-2 text-muted-foreground">
            <FolderPlus className="h-3.5 w-3.5" />
            New Project
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
