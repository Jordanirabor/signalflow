'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatICPProfileLabel } from '@/lib/icpProfileLabel';
import type { ICPProfile, ICPProject, ICPSet } from '@/types';
import { useEffect, useState } from 'react';

const ALL_PROJECTS_VALUE = '__all_projects__';
const ALL_PROFILES_VALUE = '__all_profiles__';

export interface RunScopeSelection {
  scope: 'all' | 'project' | 'profile';
  projectId?: string;
  icpProfileId?: string;
}

export interface RunScopeSelectorProps {
  founderId: string;
  value: RunScopeSelection;
  onChange: (selection: RunScopeSelection) => void;
  disabled?: boolean;
}

export function RunScopeSelector({ founderId, value, onChange, disabled }: RunScopeSelectorProps) {
  const [projects, setProjects] = useState<ICPProject[]>([]);
  const [profiles, setProfiles] = useState<ICPProfile[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(false);

  // Fetch projects on mount
  useEffect(() => {
    if (!founderId) return;
    let cancelled = false;

    async function fetchProjects() {
      setLoadingProjects(true);
      try {
        const res = await fetch('/api/projects');
        if (res.ok) {
          const data: ICPProject[] = await res.json();
          if (!cancelled) {
            setProjects(data.filter((p) => !p.isDeleted && p.isActive));
          }
        }
      } catch {
        // Silently handle fetch errors
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    }

    fetchProjects();
    return () => {
      cancelled = true;
    };
  }, [founderId]);

  // Fetch ICP profiles when a project is selected
  useEffect(() => {
    if (!value.projectId) {
      setProfiles([]);
      return;
    }
    let cancelled = false;

    async function fetchProfiles() {
      setLoadingProfiles(true);
      try {
        const res = await fetch(`/api/icp/profiles?projectId=${value.projectId}`);
        if (res.ok) {
          const data: ICPSet = await res.json();
          if (!cancelled) {
            setProfiles(data.profiles.filter((p) => p.isActive));
          }
        }
      } catch {
        // Silently handle fetch errors
      } finally {
        if (!cancelled) setLoadingProfiles(false);
      }
    }

    fetchProfiles();
    return () => {
      cancelled = true;
    };
  }, [value.projectId]);

  const handleProjectChange = (val: string) => {
    if (val === ALL_PROJECTS_VALUE) {
      onChange({ scope: 'all' });
    } else {
      onChange({ scope: 'project', projectId: val });
    }
  };

  const handleProfileChange = (val: string) => {
    if (val === ALL_PROFILES_VALUE) {
      onChange({ scope: 'project', projectId: value.projectId });
    } else {
      onChange({ scope: 'profile', projectId: value.projectId, icpProfileId: val });
    }
  };

  const projectSelectValue =
    value.scope === 'all' ? ALL_PROJECTS_VALUE : (value.projectId ?? ALL_PROJECTS_VALUE);
  const profileSelectValue =
    value.scope === 'profile' ? (value.icpProfileId ?? ALL_PROFILES_VALUE) : ALL_PROFILES_VALUE;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={projectSelectValue}
        onValueChange={handleProjectChange}
        disabled={disabled || loadingProjects}
      >
        <SelectTrigger className="w-[220px]" aria-label="Select project scope">
          <SelectValue placeholder="All Projects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_PROJECTS_VALUE}>All Projects</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {value.scope !== 'all' && value.projectId && (
        <Select
          value={profileSelectValue}
          onValueChange={handleProfileChange}
          disabled={disabled || loadingProfiles}
        >
          <SelectTrigger className="w-[220px]" aria-label="Select ICP profile">
            <SelectValue placeholder="All Profiles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROFILES_VALUE}>All Profiles</SelectItem>
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {formatICPProfileLabel(profile)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
