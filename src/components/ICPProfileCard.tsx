'use client';

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

  // Edit form state
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
    if (painPoints.length < 10) {
      setPainPoints((prev) => [...prev, '']);
    }
  }

  function removePainPoint(index: number) {
    if (painPoints.length > 1) {
      setPainPoints((prev) => prev.filter((_, i) => i !== index));
    }
  }

  function handleBuyingSignalChange(index: number, value: string) {
    setBuyingSignals((prev) => prev.map((s, i) => (i === index ? value : s)));
  }

  function addBuyingSignal() {
    if (buyingSignals.length < 5) {
      setBuyingSignals((prev) => [...prev, '']);
    }
  }

  function removeBuyingSignal(index: number) {
    if (buyingSignals.length > 1) {
      setBuyingSignals((prev) => prev.filter((_, i) => i !== index));
    }
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
      const res = await fetch(`/api/icp/profiles/${profile.id}`, {
        method: 'DELETE',
      });

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
    <div
      className={`icp-profile-card${profile.isActive ? '' : ' icp-profile-card-inactive'}`}
      aria-label={`ICP Profile: ${profile.targetRole}`}
    >
      {feedback && (
        <div className={`form-feedback ${feedback.type}`} role="status">
          {feedback.message}
        </div>
      )}

      {!editing ? (
        <>
          <div className="icp-profile-card-header">
            <h3 className="icp-profile-card-title">{profile.targetRole}</h3>
            <div className="icp-profile-card-actions">
              <label className="icp-toggle-label">
                <input
                  type="checkbox"
                  checked={profile.isActive}
                  onChange={handleToggleActive}
                  disabled={toggling}
                  aria-label={`Toggle ${profile.targetRole} active`}
                />
                <span className="icp-toggle-text">{profile.isActive ? 'Active' : 'Inactive'}</span>
              </label>
              <button
                type="button"
                className="action-btn icp-edit-btn"
                onClick={() => {
                  resetForm();
                  setEditing(true);
                }}
              >
                Edit
              </button>
              {!confirmingDelete ? (
                <button
                  type="button"
                  className="btn-delete"
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete
                </button>
              ) : (
                <span className="icp-delete-confirm" role="alert">
                  <span>Delete this profile?</span>
                  <button
                    type="button"
                    className="btn-delete"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    className="action-btn icp-cancel-btn"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </button>
                </span>
              )}
            </div>
          </div>

          <div className="icp-profile-card-body">
            <div className="icp-profile-field">
              <span className="icp-profile-label">Industry</span>
              <span className="icp-profile-value">{profile.industry}</span>
            </div>
            {profile.geography && (
              <div className="icp-profile-field">
                <span className="icp-profile-label">Geography</span>
                <span className="icp-profile-value">{profile.geography}</span>
              </div>
            )}
            {profile.companyStage && (
              <div className="icp-profile-field">
                <span className="icp-profile-label">Company Stage</span>
                <span className="icp-profile-value">{profile.companyStage}</span>
              </div>
            )}

            {profile.painPoints.length > 0 && (
              <div className="icp-profile-field">
                <span className="icp-profile-label">Pain Points</span>
                <ul className="icp-profile-list">
                  {profile.painPoints.map((pp, i) => (
                    <li key={i}>{pp}</li>
                  ))}
                </ul>
              </div>
            )}

            {profile.buyingSignals.length > 0 && (
              <div className="icp-profile-field">
                <span className="icp-profile-label">Buying Signals</span>
                <ul className="icp-profile-list">
                  {profile.buyingSignals.map((bs, i) => (
                    <li key={i}>{bs}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      ) : (
        <form onSubmit={handleSave} className="icp-profile-edit-form" noValidate>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor={`edit-targetRole-${profile.id}`}>
                Target Role <span aria-hidden="true">*</span>
              </label>
              <input
                id={`edit-targetRole-${profile.id}`}
                type="text"
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value)}
                aria-required="true"
                placeholder="e.g. VP of Engineering"
              />
            </div>
            <div className="form-field">
              <label htmlFor={`edit-industry-${profile.id}`}>
                Industry <span aria-hidden="true">*</span>
              </label>
              <input
                id={`edit-industry-${profile.id}`}
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                aria-required="true"
                placeholder="e.g. SaaS, Fintech"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label htmlFor={`edit-companyStage-${profile.id}`}>Company Stage</label>
              <input
                id={`edit-companyStage-${profile.id}`}
                type="text"
                value={companyStage}
                onChange={(e) => setCompanyStage(e.target.value)}
                placeholder="e.g. Seed, Series A"
              />
            </div>
            <div className="form-field">
              <label htmlFor={`edit-geography-${profile.id}`}>Geography</label>
              <input
                id={`edit-geography-${profile.id}`}
                type="text"
                value={geography}
                onChange={(e) => setGeography(e.target.value)}
                placeholder="e.g. US, Europe"
              />
            </div>
          </div>

          <div className="form-field">
            <label>
              Pain Points <span aria-hidden="true">*</span>
            </label>
            {painPoints.map((pp, i) => (
              <div key={i} className="icp-list-edit-row">
                <input
                  type="text"
                  value={pp}
                  onChange={(e) => handlePainPointChange(i, e.target.value)}
                  placeholder={`Pain point ${i + 1}`}
                  maxLength={200}
                  aria-label={`Pain point ${i + 1}`}
                />
                {painPoints.length > 1 && (
                  <button
                    type="button"
                    className="btn-delete icp-list-remove-btn"
                    onClick={() => removePainPoint(i)}
                    aria-label={`Remove pain point ${i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {painPoints.length < 10 && (
              <button type="button" className="action-btn icp-list-add-btn" onClick={addPainPoint}>
                + Add Pain Point
              </button>
            )}
          </div>

          <div className="form-field">
            <label>Buying Signals</label>
            {buyingSignals.map((bs, i) => (
              <div key={i} className="icp-list-edit-row">
                <input
                  type="text"
                  value={bs}
                  onChange={(e) => handleBuyingSignalChange(i, e.target.value)}
                  placeholder={`Buying signal ${i + 1}`}
                  maxLength={200}
                  aria-label={`Buying signal ${i + 1}`}
                />
                {buyingSignals.length > 1 && (
                  <button
                    type="button"
                    className="btn-delete icp-list-remove-btn"
                    onClick={() => removeBuyingSignal(i)}
                    aria-label={`Remove buying signal ${i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {buyingSignals.length < 5 && (
              <button
                type="button"
                className="action-btn icp-list-add-btn"
                onClick={addBuyingSignal}
              >
                + Add Buying Signal
              </button>
            )}
          </div>

          <div className="icp-profile-edit-actions">
            <button type="submit" className="action-btn" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" className="action-btn icp-cancel-btn" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
