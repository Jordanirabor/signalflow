'use client';

import { ICPProject } from '@/types';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const LOCAL_STORAGE_KEY = 'signalflow_selected_project_id';

interface ProjectContextValue {
  projects: ICPProject[];
  selectedProjectId: string | null;
  selectedProject: ICPProject | null;
  setSelectedProject: (projectId: string | null) => void;
  isLoading: boolean;
  error: string | null;
  refreshProjects: () => void;
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ICPProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Load persisted project ID from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        setSelectedProjectId(stored);
      }
    } catch {
      // localStorage unavailable — ignore
    }
    setInitialized(true);
  }, []);

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      const data: ICPProject[] = await res.json();
      setProjects(data);

      // Auto-select logic
      if (data.length === 1) {
        setSelectedProjectId(data[0].id);
      } else if (data.length > 0 && selectedProjectId) {
        // Verify the stored ID still exists in the list
        const exists = data.some((p) => p.id === selectedProjectId);
        if (!exists) {
          setSelectedProjectId(data[0].id);
        }
      } else if (data.length > 0 && !selectedProjectId) {
        setSelectedProjectId(data[0].id);
      } else if (data.length === 0) {
        setSelectedProjectId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setIsLoading(false);
    }
  }, [selectedProjectId]);

  // Fetch projects once initialized
  useEffect(() => {
    if (initialized) {
      fetchProjects();
    }
    // Only run when initialized flips to true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);

  // Persist selected project ID to localStorage
  useEffect(() => {
    if (!initialized) return;
    try {
      if (selectedProjectId) {
        localStorage.setItem(LOCAL_STORAGE_KEY, selectedProjectId);
      } else {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable — ignore
    }
  }, [selectedProjectId, initialized]);

  const setSelectedProject = useCallback((projectId: string | null) => {
    setSelectedProjectId(projectId);
  }, []);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      selectedProjectId,
      selectedProject,
      setSelectedProject,
      isLoading,
      error,
      refreshProjects: fetchProjects,
    }),
    [
      projects,
      selectedProjectId,
      selectedProject,
      setSelectedProject,
      isLoading,
      error,
      fetchProjects,
    ],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return ctx;
}
