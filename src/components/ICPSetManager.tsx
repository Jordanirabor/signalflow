'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/hooks/useSession';
import type { ICPProfile, ICPSet } from '@/types';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import ICPProfileCard from './ICPProfileCard';

interface ICPSetManagerProps {
  onRegenerate?: () => void;
}

export default function ICPSetManager({ onRegenerate }: ICPSetManagerProps) {
  const { session, isLoading: sessionLoading } = useSession();
  const [icpSet, setIcpSet] = useState<ICPSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Add-profile form state
  const [newTargetRole, setNewTargetRole] = useState('');
  const [newIndustry, setNewIndustry] = useState('');
  const [newPainPoints, setNewPainPoints] = useState<string[]>(['']);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const fetchICPSet = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/icp/profiles');
      if (!res.ok) {
        throw new Error('Failed to load ICP profiles');
      }
      const data: ICPSet = await res.json();
      setIcpSet(data);
    } catch {
      setError('Failed to load ICP profiles. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchICPSet();
  }, [fetchICPSet]);

  const handleUpdate = useCallback((updated: ICPProfile) => {
    setIcpSet((prev) => {
      if (!prev) return prev;
      const profiles = prev.profiles.map((p) => (p.id === updated.id ? updated : p));
      const activeCount = profiles.filter((p) => p.isActive).length;
      return { ...prev, profiles, activeCount };
    });
  }, []);

  const handleDelete = useCallback((profileId: string) => {
    setIcpSet((prev) => {
      if (!prev) return prev;
      const profiles = prev.profiles.filter((p) => p.id !== profileId);
      const activeCount = profiles.filter((p) => p.isActive).length;
      return { ...prev, profiles, activeCount };
    });
  }, []);

  const handleToggleActive = useCallback((profileId: string, isActive: boolean) => {
    setIcpSet((prev) => {
      if (!prev) return prev;
      const profiles = prev.profiles.map((p) => (p.id === profileId ? { ...p, isActive } : p));
      const activeCount = profiles.filter((p) => p.isActive).length;
      return { ...prev, profiles, activeCount };
    });
  }, []);

  function resetAddForm() {
    setNewTargetRole('');
    setNewIndustry('');
    setNewPainPoints(['']);
    setAddError(null);
  }

  function handleAddPainPointChange(index: number, value: string) {
    setNewPainPoints((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  function addPainPointField() {
    if (newPainPoints.length < 10) {
      setNewPainPoints((prev) => [...prev, '']);
    }
  }

  function removePainPointField(index: number) {
    if (newPainPoints.length > 1) {
      setNewPainPoints((prev) => prev.filter((_, i) => i !== index));
    }
  }

  async function handleAddProfile(e: FormEvent) {
    e.preventDefault();
    if (!newTargetRole.trim() || !newIndustry.trim()) {
      setAddError('Target role and industry are required.');
      return;
    }
    const filteredPainPoints = newPainPoints.map((p) => p.trim()).filter(Boolean);
    if (filteredPainPoints.length === 0) {
      setAddError('At least one pain point is required.');
      return;
    }

    setAddSaving(true);
    setAddError(null);
    try {
      const res = await fetch('/api/icp/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetRole: newTargetRole.trim(),
          industry: newIndustry.trim(),
          painPoints: filteredPainPoints,
          buyingSignals: [],
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setAddError(err.message ?? 'Failed to create profile.');
        return;
      }

      const created: ICPProfile = await res.json();
      setIcpSet((prev) => {
        if (!prev) {
          return {
            founderId: session?.founderId ?? '',
            profiles: [created],
            activeCount: created.isActive ? 1 : 0,
          };
        }
        const profiles = [...prev.profiles, created];
        const activeCount = profiles.filter((p) => p.isActive).length;
        return { ...prev, profiles, activeCount };
      });
      resetAddForm();
      setShowAddForm(false);
    } catch {
      setAddError('Network error. Please try again.');
    } finally {
      setAddSaving(false);
    }
  }

  if (sessionLoading || loading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={fetchICPSet}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const profiles = icpSet?.profiles ?? [];
  const activeCount = icpSet?.activeCount ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold tracking-tight">ICP Profiles</h2>
          <Badge variant="secondary">{activeCount} active</Badge>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              resetAddForm();
              setShowAddForm((prev) => !prev);
            }}
          >
            {showAddForm ? 'Cancel' : 'Add Profile'}
          </Button>
          {onRegenerate && (
            <Button variant="secondary" onClick={onRegenerate}>
              Regenerate ICPs
            </Button>
          )}
        </div>
      </div>

      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Add New Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddProfile} className="space-y-4" noValidate>
              {addError && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{addError}</AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="add-targetRole" className="text-sm font-medium">
                    Target Role <span aria-hidden="true">*</span>
                  </label>
                  <Input
                    id="add-targetRole"
                    type="text"
                    value={newTargetRole}
                    onChange={(e) => setNewTargetRole(e.target.value)}
                    aria-required="true"
                    placeholder="e.g. VP of Engineering"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="add-industry" className="text-sm font-medium">
                    Industry <span aria-hidden="true">*</span>
                  </label>
                  <Input
                    id="add-industry"
                    type="text"
                    value={newIndustry}
                    onChange={(e) => setNewIndustry(e.target.value)}
                    aria-required="true"
                    placeholder="e.g. SaaS, Fintech"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Pain Points <span aria-hidden="true">*</span>
                </label>
                {newPainPoints.map((pp, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={pp}
                      onChange={(e) => handleAddPainPointChange(i, e.target.value)}
                      placeholder={`Pain point ${i + 1}`}
                      maxLength={200}
                      aria-label={`Pain point ${i + 1}`}
                    />
                    {newPainPoints.length > 1 && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        onClick={() => removePainPointField(i)}
                        aria-label={`Remove pain point ${i + 1}`}
                      >
                        ✕
                      </Button>
                    )}
                  </div>
                ))}
                {newPainPoints.length < 10 && (
                  <Button type="button" variant="ghost" size="sm" onClick={addPainPointField}>
                    + Add Pain Point
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={addSaving}>
                  {addSaving ? 'Creating…' : 'Create Profile'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    resetAddForm();
                    setShowAddForm(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {profiles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">
              No ICP profiles yet. Add a profile manually or generate ICPs from your product
              description.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                resetAddForm();
                setShowAddForm(true);
              }}
            >
              Add Your First Profile
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {profiles.map((profile) => (
            <ICPProfileCard
              key={profile.id}
              profile={profile}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onToggleActive={handleToggleActive}
            />
          ))}
        </div>
      )}
    </div>
  );
}
