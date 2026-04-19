'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatICPProfileLabel } from '@/lib/icpProfileLabel';
import type { ICPProfile, ICPSet } from '@/types';
import { useEffect, useState } from 'react';

const ALL_PROFILES_VALUE = '__all_profiles__';

interface ICPProfileSelectorProps {
  projectId: string | null;
  value: string | null;
  onChange: (icpProfileId: string | null) => void;
  disabled?: boolean;
}

export function ICPProfileSelector({
  projectId,
  value,
  onChange,
  disabled,
}: ICPProfileSelectorProps) {
  const [profiles, setProfiles] = useState<ICPProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch profiles when projectId changes
  useEffect(() => {
    let cancelled = false;

    // Reset to "All Profiles" when projectId changes
    onChange(null);

    if (!projectId) {
      setProfiles([]);
      return;
    }

    async function fetchProfiles() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/icp/profiles?projectId=${projectId}`);
        if (res.ok) {
          const data: ICPSet = await res.json();
          if (!cancelled) {
            setProfiles(data.profiles.filter((p) => p.isActive));
          }
        }
      } catch {
        // Silently handle fetch errors — profiles list stays empty
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchProfiles();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleValueChange = (val: string) => {
    onChange(val === ALL_PROFILES_VALUE ? null : val);
  };

  return (
    <Select
      value={value ?? ALL_PROFILES_VALUE}
      onValueChange={handleValueChange}
      disabled={disabled || isLoading || !projectId}
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
  );
}
