'use client';

import { FOUNDER_ID } from '@/lib/constants';
import { useState } from 'react';

interface GeneratedProfile {
  targetRole: string;
  industry: string;
  companyStage?: string;
  geography?: string;
  painPoints: string[];
  buyingSignals: string[];
  customTags?: string[];
}

interface GenerateResponse {
  profiles: GeneratedProfile[];
  productDescription: string;
}

interface ICPFormProps {
  onConfirm?: () => void;
}

export default function ICPForm({ onConfirm }: ICPFormProps) {
  const [productDescription, setProductDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  // Generated profiles pending review
  const [generatedProfiles, setGeneratedProfiles] = useState<GeneratedProfile[] | null>(null);

  async function handleGenerate() {
    if (!productDescription.trim()) {
      setFeedback({ type: 'error', message: 'Please describe your product first.' });
      return;
    }

    setGenerating(true);
    setFeedback(null);
    setGeneratedProfiles(null);

    try {
      const res = await fetch('/api/icp/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productDescription: productDescription.trim(),
          founderId: FOUNDER_ID,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setFeedback({ type: 'error', message: err.message ?? 'Failed to generate ICPs' });
        return;
      }

      const data: GenerateResponse = await res.json();
      setGeneratedProfiles(data.profiles);
      setFeedback({
        type: 'success',
        message: `Generated ${data.profiles.length} ICP profiles. Review below and confirm to save.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setFeedback({ type: 'error', message: `Error generating ICPs: ${msg}` });
    } finally {
      setGenerating(false);
    }
  }

  async function handleConfirm() {
    if (!generatedProfiles || generatedProfiles.length === 0) return;

    setConfirming(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/icp/generate/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          founderId: FOUNDER_ID,
          profiles: generatedProfiles,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setFeedback({ type: 'error', message: err.message ?? 'Failed to save ICP set' });
        return;
      }

      setGeneratedProfiles(null);
      setFeedback({
        type: 'success',
        message: 'ICP set saved successfully. Lead scores are being recalculated.',
      });
      onConfirm?.();
    } catch {
      setFeedback({ type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setConfirming(false);
    }
  }

  function handleCancel() {
    setGeneratedProfiles(null);
    setFeedback(null);
  }

  return (
    <div className="icp-page">
      {/* AI Generation Section */}
      <section className="icp-generate-section" id="icp-generate-section">
        <h2>Generate ICP from Your Product</h2>
        <p className="icp-generate-hint">
          Describe what your product does and who it helps. The AI will generate multiple ideal
          customer profiles targeting different buyer personas.
        </p>
        <div className="form-field">
          <label htmlFor="icp-productDesc">Product Description</label>
          <textarea
            id="icp-productDesc"
            value={productDescription}
            onChange={(e) => setProductDescription(e.target.value)}
            placeholder="e.g. We build an AI-powered code review tool that helps engineering teams catch bugs before they ship. It integrates with GitHub and GitLab and is used by mid-size SaaS companies..."
            rows={4}
          />
        </div>
        <button
          type="button"
          className="action-btn icp-generate-btn"
          onClick={handleGenerate}
          disabled={generating || confirming || !productDescription.trim()}
        >
          {generating ? '✨ Generating ICPs...' : '✨ Generate ICP with AI'}
        </button>
      </section>

      {feedback && (
        <div className={`form-feedback ${feedback.type}`} role="status">
          {feedback.message}
        </div>
      )}

      {/* Generated profiles preview */}
      {generatedProfiles && generatedProfiles.length > 0 && (
        <section className="icp-preview-section">
          <div className="icp-preview-header">
            <h2>Review Generated Profiles</h2>
            <p className="icp-preview-notice">
              Your existing ICP set is still active while you review. Confirm to replace it with
              these new profiles.
            </p>
          </div>

          <div className="icp-preview-grid">
            {generatedProfiles.map((profile, index) => (
              <div
                key={index}
                className="icp-preview-card"
                aria-label={`Preview: ${profile.targetRole}`}
              >
                <div className="icp-preview-card-header">
                  <h3 className="icp-preview-card-title">{profile.targetRole}</h3>
                </div>
                <div className="icp-preview-card-body">
                  <div className="icp-preview-field">
                    <span className="icp-preview-label">Industry</span>
                    <span className="icp-preview-value">{profile.industry}</span>
                  </div>
                  {profile.geography && (
                    <div className="icp-preview-field">
                      <span className="icp-preview-label">Geography</span>
                      <span className="icp-preview-value">{profile.geography}</span>
                    </div>
                  )}
                  {profile.companyStage && (
                    <div className="icp-preview-field">
                      <span className="icp-preview-label">Company Stage</span>
                      <span className="icp-preview-value">{profile.companyStage}</span>
                    </div>
                  )}
                  {profile.painPoints.length > 0 && (
                    <div className="icp-preview-field">
                      <span className="icp-preview-label">Pain Points</span>
                      <ul className="icp-preview-list">
                        {profile.painPoints.map((pp, i) => (
                          <li key={i}>{pp}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {profile.buyingSignals.length > 0 && (
                    <div className="icp-preview-field">
                      <span className="icp-preview-label">Buying Signals</span>
                      <ul className="icp-preview-list">
                        {profile.buyingSignals.map((bs, i) => (
                          <li key={i}>{bs}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="icp-preview-actions">
            <button
              type="button"
              className="action-btn icp-confirm-btn"
              onClick={handleConfirm}
              disabled={confirming}
            >
              {confirming ? 'Saving...' : 'Confirm & Save'}
            </button>
            <button
              type="button"
              className="action-btn icp-cancel-btn"
              onClick={handleCancel}
              disabled={confirming}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
