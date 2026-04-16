'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import type { ICPProfile } from '@/types';
import { useState, type FormEvent } from 'react';

interface ICPProfileCardProps {
  profile: ICPProfile;
  onUpdate: (profile: ICPProfile) => void;
  onDelete: (profileId: string) => void;
  onToggleActive: (profileId: string, isActive: boolean) => void;
}

export default function ICPProfileCard({
  profile,
  onUpdate,
  onDelete,
  onToggleActive,
}: ICPProfileCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  const [targetRole, setTargetRole] = useState(profile.targetRole);
  const [industry, setIndustry] = useState(profile.industry);
  const [companyStage, setCompanyStage] = useState(profile.companyStage ?? '');
  const [geography, setGeography] = useState(profile.geography ?? '');
  const [painPoints, setPainPoints] = useState<string[]>([...profile.painPoints]);
  const [buyingSignals, setBuyingSignals] = useState<string[]>([...profile.buyingSignals]);

  function resetForm() {
    setTargetRole(profile.targetRole);
    setIndustry(profile.industry);
    setCompanyStage(profile.companyStage ?? '');
    setGeography(profile.geography ?? '');
    setPainPoints([...profile.painPoints]);
    setBuyingSignals([...profile.buyingSignals]);
    setFeedback(null);
  }

  function handleCancel() {
    resetForm();
    setEditing(false);
  }

  function handlePainPointChange(index: number, value: string) {
    setPainPoints((prev) => prev.map((p, i) => (i === index ? value : p)));
  }
  function addPainPoint() {
    if (painPoints.length < 10) setPainPoints((prev) => [...prev, '']);
  }
  function removePainPoint(index: number) {
    if (painPoints.length > 1) setPainPoints((prev) => prev.filter((_, i) => i !== index));
  }

  function handleBuyingSignalChange(index: number, value: string) {
    setBuyingSignals((prev) => prev.map((s, i) => (i === index ? value : s)));
  }
  function addBuyingSignal() {
    if (buyingSignals.length < 5) setBuyingSignals((prev) => [...prev, '']);
  }
  function removeBuyingSignal(index: number) {
    if (buyingSignals.length > 1) setBuyingSignals((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!targetRole.trim() || !industry.trim()) {
      setFeedback({ type: 'error', message: 'Target role and industry are required.' });
      return;
    }
    const filteredPainPoints = painPoints.map((p) => p.trim()).filter(Boolean);
    if (filteredPainPoints.length === 0) {
      setFeedback({ type: 'error', message: 'At least one pain point is required.' });
      return;
    }
    const filteredSignals = buyingSignals.map((s) => s.trim()).filter(Boolean);

    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/icp/profiles/${profile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetRole: targetRole.trim(),
          industry: industry.trim(),
          companyStage: companyStage.trim() || undefined,
          geography: geography.trim() || undefined,
          painPoints: filteredPainPoints,
          buyingSignals: filteredSignals.length > 0 ? filteredSignals : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setFeedback({ type: 'error', message: err.message ?? 'Failed to update profile.' });
        return;
      }
      const updated: ICPProfile = await res.json();
      onUpdate(updated);
      setEditing(false);
      setFeedback({ type: 'success', message: 'Profile updated.' });
    } catch {
      setFeedback({ type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    const newActive = !profile.isActive;
    setToggling(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/icp/profiles/${profile.id}/active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newActive }),
      });
      if (!res.ok) {
        const err = await res.json();
        setFeedback({ type: 'error', message: err.message ?? 'Failed to toggle active state.' });
        return;
      }
      onToggleActive(profile.id, newActive);
    } catch {
      setFeedback({ type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/icp/profiles/${profile.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        setFeedback({ type: 'error', message: err.message ?? 'Failed to delete profile.' });
        setConfirmingDelete(false);
        return;
      }
      onDelete(profile.id);
    } catch {
      setFeedback({ type: 'error', message: 'Network error. Please try again.' });
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card
      className={!profile.isActive ? 'opacity-60' : ''}
      aria-label={`ICP Profile: ${profile.targetRole}`}
    >
      {feedback && (
        <div className="px-6 pt-4">
          <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'} role="status">
            <AlertDescription>{feedback.message}</AlertDescription>
          </Alert>
        </div>
      )}

      {!editing ? (
        <>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base">{profile.targetRole}</CardTitle>
              <Badge variant={profile.isActive ? 'default' : 'secondary'}>
                {profile.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  resetForm();
                  setEditing(true);
                }}
              >
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={handleToggleActive} disabled={toggling}>
                {toggling ? '...' : profile.isActive ? 'Deactivate' : 'Activate'}
              </Button>
              {!confirmingDelete ? (
                <Button variant="destructive" size="sm" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
              ) : (
                <div className="flex items-center gap-2" role="alert">
                  <span className="text-sm text-destructive">Delete?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting...' : 'Confirm'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="space-y-3 pt-4 text-sm">
            <div className="flex justify-between">
              <span className="font-medium text-muted-foreground">Industry</span>
              <span>{profile.industry}</span>
            </div>
            {profile.geography && (
              <div className="flex justify-between">
                <span className="font-medium text-muted-foreground">Geography</span>
                <span>{profile.geography}</span>
              </div>
            )}
            {profile.companyStage && (
              <div className="flex justify-between">
                <span className="font-medium text-muted-foreground">Company Stage</span>
                <span>{profile.companyStage}</span>
              </div>
            )}
            {profile.painPoints.length > 0 && (
              <div>
                <span className="font-medium text-muted-foreground">Pain Points</span>
                <ul className="mt-1 ml-4 list-disc space-y-0.5 text-muted-foreground">
                  {profile.painPoints.map((pp, i) => (
                    <li key={i}>{pp}</li>
                  ))}
                </ul>
              </div>
            )}
            {profile.buyingSignals.length > 0 && (
              <div>
                <span className="font-medium text-muted-foreground">Buying Signals</span>
                <ul className="mt-1 ml-4 list-disc space-y-0.5 text-muted-foreground">
                  {profile.buyingSignals.map((bs, i) => (
                    <li key={i}>{bs}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </>
      ) : (
        <CardContent className="pt-6">
          <form onSubmit={handleSave} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor={`edit-targetRole-${profile.id}`} className="text-sm font-medium">
                  Target Role <span aria-hidden="true">*</span>
                </label>
                <Input
                  id={`edit-targetRole-${profile.id}`}
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  aria-required="true"
                  placeholder="e.g. VP of Engineering"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor={`edit-industry-${profile.id}`} className="text-sm font-medium">
                  Industry <span aria-hidden="true">*</span>
                </label>
                <Input
                  id={`edit-industry-${profile.id}`}
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  aria-required="true"
                  placeholder="e.g. SaaS, Fintech"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor={`edit-companyStage-${profile.id}`} className="text-sm font-medium">
                  Company Stage
                </label>
                <Input
                  id={`edit-companyStage-${profile.id}`}
                  value={companyStage}
                  onChange={(e) => setCompanyStage(e.target.value)}
                  placeholder="e.g. Seed, Series A"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor={`edit-geography-${profile.id}`} className="text-sm font-medium">
                  Geography
                </label>
                <Input
                  id={`edit-geography-${profile.id}`}
                  value={geography}
                  onChange={(e) => setGeography(e.target.value)}
                  placeholder="e.g. US, Europe"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Pain Points <span aria-hidden="true">*</span>
              </label>
              {painPoints.map((pp, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={pp}
                    onChange={(e) => handlePainPointChange(i, e.target.value)}
                    placeholder={`Pain point ${i + 1}`}
                    maxLength={200}
                    aria-label={`Pain point ${i + 1}`}
                  />
                  {painPoints.length > 1 && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      onClick={() => removePainPoint(i)}
                      aria-label={`Remove pain point ${i + 1}`}
                    >
                      ✕
                    </Button>
                  )}
                </div>
              ))}
              {painPoints.length < 10 && (
                <Button type="button" variant="ghost" size="sm" onClick={addPainPoint}>
                  + Add Pain Point
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Buying Signals</label>
              {buyingSignals.map((bs, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={bs}
                    onChange={(e) => handleBuyingSignalChange(i, e.target.value)}
                    placeholder={`Buying signal ${i + 1}`}
                    maxLength={200}
                    aria-label={`Buying signal ${i + 1}`}
                  />
                  {buyingSignals.length > 1 && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      onClick={() => removeBuyingSignal(i)}
                      aria-label={`Remove buying signal ${i + 1}`}
                    >
                      ✕
                    </Button>
                  )}
                </div>
              ))}
              {buyingSignals.length < 5 && (
                <Button type="button" variant="ghost" size="sm" onClick={addBuyingSignal}>
                  + Add Buying Signal
                </Button>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button type="button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
