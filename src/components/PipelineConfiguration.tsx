'use client';

import { FOUNDER_ID } from '@/lib/constants';
import type { ApiError, PipelineConfig, TonePreference } from '@/types';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

const TONE_OPTIONS: TonePreference[] = ['professional', 'casual', 'direct'];

interface FieldErrors {
  runIntervalMinutes?: string;
  dailyDiscoveryCap?: string;
  maxFollowUps?: string;
  minLeadScore?: string;
  sequenceCadenceDays?: string;
  tonePreference?: string;
  productContext?: string;
  valueProposition?: string;
  targetPainPoints?: string;
}

export default function PipelineConfiguration() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Pipeline parameters
  const [runIntervalMinutes, setRunIntervalMinutes] = useState(60);
  const [dailyDiscoveryCap, setDailyDiscoveryCap] = useState(50);
  const [maxFollowUps, setMaxFollowUps] = useState(3);
  const [minLeadScore, setMinLeadScore] = useState(50);
  const [sequenceCadenceInput, setSequenceCadenceInput] = useState('3, 5, 7');
  const [tonePreference, setTonePreference] = useState<TonePreference>('professional');

  // Strategy inputs
  const [productContext, setProductContext] = useState('');
  const [valueProposition, setValueProposition] = useState('');
  const [targetPainPointsInput, setTargetPainPointsInput] = useState('');

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pipeline/config?founderId=${FOUNDER_ID}`);
      if (!res.ok) return;
      const config: PipelineConfig = await res.json();
      setRunIntervalMinutes(config.runIntervalMinutes);
      setDailyDiscoveryCap(config.dailyDiscoveryCap);
      setMaxFollowUps(config.maxFollowUps);
      setMinLeadScore(config.minLeadScore);
      setSequenceCadenceInput(config.sequenceCadenceDays.join(', '));
      setTonePreference(config.tonePreference);
      setProductContext(config.productContext);
      setValueProposition(config.valueProposition);
      setTargetPainPointsInput(config.targetPainPoints.join(', '));
    } catch {
      /* silent — defaults are fine */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  function validate(): boolean {
    const errors: FieldErrors = {};

    if (
      !Number.isInteger(runIntervalMinutes) ||
      runIntervalMinutes < 15 ||
      runIntervalMinutes > 240
    ) {
      errors.runIntervalMinutes = 'Run interval must be an integer between 15 and 240 minutes';
    }

    if (!Number.isInteger(dailyDiscoveryCap) || dailyDiscoveryCap < 10 || dailyDiscoveryCap > 200) {
      errors.dailyDiscoveryCap = 'Discovery cap must be an integer between 10 and 200';
    }

    if (!Number.isInteger(maxFollowUps) || maxFollowUps < 1 || maxFollowUps > 5) {
      errors.maxFollowUps = 'Max follow-ups must be an integer between 1 and 5';
    }

    if (!Number.isInteger(minLeadScore) || minLeadScore < 30 || minLeadScore > 90) {
      errors.minLeadScore = 'Min lead score must be an integer between 30 and 90';
    }

    const cadenceParts = sequenceCadenceInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (cadenceParts.length === 0) {
      errors.sequenceCadenceDays = 'At least one cadence day is required';
    } else {
      const allValid = cadenceParts.every((p) => {
        const n = Number(p);
        return Number.isInteger(n) && n > 0;
      });
      if (!allValid) {
        errors.sequenceCadenceDays = 'Cadence days must be comma-separated positive integers';
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const sequenceCadenceDays = sequenceCadenceInput
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => !isNaN(n));

      const targetPainPoints = targetPainPointsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch('/api/pipeline/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          founderId: FOUNDER_ID,
          runIntervalMinutes,
          dailyDiscoveryCap,
          maxFollowUps,
          minLeadScore,
          sequenceCadenceDays,
          tonePreference,
          productContext,
          valueProposition,
          targetPainPoints,
        }),
      });

      if (!res.ok) {
        const err: ApiError = await res.json();
        if (err.details) {
          const fe: FieldErrors = {};
          if (err.details.runIntervalMinutes)
            fe.runIntervalMinutes = err.details.runIntervalMinutes;
          if (err.details.dailyDiscoveryCap) fe.dailyDiscoveryCap = err.details.dailyDiscoveryCap;
          if (err.details.maxFollowUps) fe.maxFollowUps = err.details.maxFollowUps;
          if (err.details.minLeadScore) fe.minLeadScore = err.details.minLeadScore;
          setFieldErrors(fe);
        }
        setFeedback({ type: 'error', message: err.message });
        return;
      }

      setFeedback({
        type: 'success',
        message: 'Configuration saved. Changes will apply starting from the next pipeline run.',
      });
    } catch {
      setFeedback({ type: 'error', message: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="pipeline-config-loading" role="status" aria-live="polite">
        Loading configuration...
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="pipeline-config-form" noValidate>
      <h2>Pipeline Configuration</h2>

      {/* Pipeline Parameters */}
      <section aria-label="Pipeline parameters">
        <h3>Pipeline Parameters</h3>

        <div className="form-field">
          <label htmlFor="cfg-runInterval">Run Interval (minutes)</label>
          <input
            id="cfg-runInterval"
            type="number"
            min={15}
            max={240}
            value={runIntervalMinutes}
            onChange={(e) => {
              setRunIntervalMinutes(Number(e.target.value));
              setFieldErrors((p) => ({ ...p, runIntervalMinutes: undefined }));
            }}
            aria-invalid={!!fieldErrors.runIntervalMinutes}
            aria-describedby={
              fieldErrors.runIntervalMinutes ? 'cfg-runInterval-error' : 'cfg-runInterval-hint'
            }
          />
          <span id="cfg-runInterval-hint" className="field-hint">
            15–240 minutes
          </span>
          {fieldErrors.runIntervalMinutes && (
            <span id="cfg-runInterval-error" className="field-error" role="alert">
              {fieldErrors.runIntervalMinutes}
            </span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="cfg-discoveryCap">Daily Discovery Cap</label>
          <input
            id="cfg-discoveryCap"
            type="number"
            min={10}
            max={200}
            value={dailyDiscoveryCap}
            onChange={(e) => {
              setDailyDiscoveryCap(Number(e.target.value));
              setFieldErrors((p) => ({ ...p, dailyDiscoveryCap: undefined }));
            }}
            aria-invalid={!!fieldErrors.dailyDiscoveryCap}
            aria-describedby={
              fieldErrors.dailyDiscoveryCap ? 'cfg-discoveryCap-error' : 'cfg-discoveryCap-hint'
            }
          />
          <span id="cfg-discoveryCap-hint" className="field-hint">
            10–200 prospects per day
          </span>
          {fieldErrors.dailyDiscoveryCap && (
            <span id="cfg-discoveryCap-error" className="field-error" role="alert">
              {fieldErrors.dailyDiscoveryCap}
            </span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="cfg-cadence">Sequence Cadence (days)</label>
          <input
            id="cfg-cadence"
            type="text"
            value={sequenceCadenceInput}
            onChange={(e) => {
              setSequenceCadenceInput(e.target.value);
              setFieldErrors((p) => ({ ...p, sequenceCadenceDays: undefined }));
            }}
            aria-invalid={!!fieldErrors.sequenceCadenceDays}
            aria-describedby={
              fieldErrors.sequenceCadenceDays ? 'cfg-cadence-error' : 'cfg-cadence-hint'
            }
            placeholder="e.g. 3, 5, 7"
          />
          <span id="cfg-cadence-hint" className="field-hint">
            Comma-separated days between follow-ups
          </span>
          {fieldErrors.sequenceCadenceDays && (
            <span id="cfg-cadence-error" className="field-error" role="alert">
              {fieldErrors.sequenceCadenceDays}
            </span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="cfg-maxFollowUps">Max Follow-Ups</label>
          <input
            id="cfg-maxFollowUps"
            type="number"
            min={1}
            max={5}
            value={maxFollowUps}
            onChange={(e) => {
              setMaxFollowUps(Number(e.target.value));
              setFieldErrors((p) => ({ ...p, maxFollowUps: undefined }));
            }}
            aria-invalid={!!fieldErrors.maxFollowUps}
            aria-describedby={
              fieldErrors.maxFollowUps ? 'cfg-maxFollowUps-error' : 'cfg-maxFollowUps-hint'
            }
          />
          <span id="cfg-maxFollowUps-hint" className="field-hint">
            1–5 follow-ups per prospect
          </span>
          {fieldErrors.maxFollowUps && (
            <span id="cfg-maxFollowUps-error" className="field-error" role="alert">
              {fieldErrors.maxFollowUps}
            </span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="cfg-minLeadScore">Min Lead Score</label>
          <input
            id="cfg-minLeadScore"
            type="number"
            min={30}
            max={90}
            value={minLeadScore}
            onChange={(e) => {
              setMinLeadScore(Number(e.target.value));
              setFieldErrors((p) => ({ ...p, minLeadScore: undefined }));
            }}
            aria-invalid={!!fieldErrors.minLeadScore}
            aria-describedby={
              fieldErrors.minLeadScore ? 'cfg-minLeadScore-error' : 'cfg-minLeadScore-hint'
            }
          />
          <span id="cfg-minLeadScore-hint" className="field-hint">
            30–90 minimum score for outreach
          </span>
          {fieldErrors.minLeadScore && (
            <span id="cfg-minLeadScore-error" className="field-error" role="alert">
              {fieldErrors.minLeadScore}
            </span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="cfg-tone">Tone Preference</label>
          <select
            id="cfg-tone"
            value={tonePreference}
            onChange={(e) => setTonePreference(e.target.value as TonePreference)}
          >
            {TONE_OPTIONS.map((tone) => (
              <option key={tone} value={tone}>
                {tone.charAt(0).toUpperCase() + tone.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Strategy Inputs */}
      <section aria-label="Outreach strategy">
        <h3>Outreach Strategy</h3>

        <div className="form-field">
          <label htmlFor="cfg-productContext">Product Context</label>
          <textarea
            id="cfg-productContext"
            value={productContext}
            onChange={(e) => setProductContext(e.target.value)}
            placeholder="Describe your product, what it does, and who it's for..."
            rows={3}
          />
        </div>

        <div className="form-field">
          <label htmlFor="cfg-valueProposition">Value Proposition</label>
          <textarea
            id="cfg-valueProposition"
            value={valueProposition}
            onChange={(e) => setValueProposition(e.target.value)}
            placeholder="What unique value does your product deliver to prospects?"
            rows={3}
          />
        </div>

        <div className="form-field">
          <label htmlFor="cfg-painPoints">Target Pain Points</label>
          <input
            id="cfg-painPoints"
            type="text"
            value={targetPainPointsInput}
            onChange={(e) => setTargetPainPointsInput(e.target.value)}
            placeholder="Comma-separated, e.g. slow onboarding, high churn, manual processes"
          />
          <span className="field-hint">
            Comma-separated list of pain points your product addresses
          </span>
        </div>
      </section>

      {feedback && (
        <div className={`form-feedback ${feedback.type}`} role="status">
          {feedback.message}
        </div>
      )}

      <button type="submit" className="action-btn" disabled={submitting}>
        {submitting ? 'Saving...' : 'Save Configuration'}
      </button>
    </form>
  );
}
