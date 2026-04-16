'use client';

import { FOUNDER_ID } from '@/lib/constants';
import type { ICPProfile, ICPSet } from '@/types';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import ICPProfileCard from './ICPProfileCard';

interface ICPSetManagerProps {
  onRegenerate?: () => void;
}

export default function ICPSetManager({ onRegenerate }: ICPSetManagerProps) {
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
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/icp/profiles?founderId=${FOUNDER_ID}`);
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
  }, []);

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
          founderId: FOUNDER_ID,
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
            founderId: FOUNDER_ID,
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

  if (loading) {
    return (
      <div className="icp-set-manager">
        <div className="icp-set-manager-loading">Loading ICP profiles…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="icp-set-manager">
        <div className="form-feedback error" role="alert">
          {error}
        </div>
        <button type="button" className="action-btn" onClick={fetchICPSet}>
          Retry
        </button>
      </div>
    );
  }

  const profiles = icpSet?.profiles ?? [];
  const activeCount = icpSet?.activeCount ?? 0;

  return (
    <div className="icp-set-manager">
      <div className="icp-set-manager-header">
        <div className="icp-set-manager-title-row">
          <h2>ICP Profiles</h2>
          <span className="icp-set-manager-badge">{activeCount} active</span>
        </div>
        <div className="icp-set-manager-actions">
          <button
            type="button"
            className="action-btn"
            onClick={() => {
              resetAddForm();
              setShowAddForm((prev) => !prev);
            }}
          >
            {showAddForm ? 'Cancel' : 'Add Profile'}
          </button>
          {onRegenerate && (
            <button type="button" className="action-btn icp-regenerate-btn" onClick={onRegenerate}>
              Regenerate ICPs
            </button>
          )}
        </div>
      </div>

      {showAddForm && (
        <form onSubmit={handleAddProfile} className="icp-add-form" noValidate>
          {addError && (
            <div className="form-feedback error" role="alert">
              {addError}
            </div>
          )}
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="add-targetRole">
                Target Role <span aria-hidden="true">*</span>
              </label>
              <input
                id="add-targetRole"
                type="text"
                value={newTargetRole}
                onChange={(e) => setNewTargetRole(e.target.value)}
                aria-required="true"
                placeholder="e.g. VP of Engineering"
              />
            </div>
            <div className="form-field">
              <label htmlFor="add-industry">
                Industry <span aria-hidden="true">*</span>
              </label>
              <input
                id="add-industry"
                type="text"
                value={newIndustry}
                onChange={(e) => setNewIndustry(e.target.value)}
                aria-required="true"
                placeholder="e.g. SaaS, Fintech"
              />
            </div>
          </div>
          <div className="form-field">
            <label>
              Pain Points <span aria-hidden="true">*</span>
            </label>
            {newPainPoints.map((pp, i) => (
              <div key={i} className="icp-list-edit-row">
                <input
                  type="text"
                  value={pp}
                  onChange={(e) => handleAddPainPointChange(i, e.target.value)}
                  placeholder={`Pain point ${i + 1}`}
                  maxLength={200}
                  aria-label={`Pain point ${i + 1}`}
                />
                {newPainPoints.length > 1 && (
                  <button
                    type="button"
                    className="btn-delete icp-list-remove-btn"
                    onClick={() => removePainPointField(i)}
                    aria-label={`Remove pain point ${i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {newPainPoints.length < 10 && (
              <button
                type="button"
                className="action-btn icp-list-add-btn"
                onClick={addPainPointField}
              >
                + Add Pain Point
              </button>
            )}
          </div>
          <div className="icp-add-form-actions">
            <button type="submit" className="action-btn" disabled={addSaving}>
              {addSaving ? 'Creating…' : 'Create Profile'}
            </button>
            <button
              type="button"
              className="action-btn icp-cancel-btn"
              onClick={() => {
                resetAddForm();
                setShowAddForm(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {profiles.length === 0 ? (
        <div className="icp-set-manager-empty">
          <p>
            No ICP profiles yet. Add a profile manually or generate ICPs from your product
            description.
          </p>
        </div>
      ) : (
        <div className="icp-set-manager-grid">
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
