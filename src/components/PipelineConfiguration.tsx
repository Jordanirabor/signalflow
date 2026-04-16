'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/useSession';
import type { ApiError, PipelineConfig, TonePreference } from '@/types';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

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
  const { session, isLoading: sessionLoading } = useSession();
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
    if (!session) return;
    setLoading(true);
    try {
      const res = await fetch('/api/pipeline/config');
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
  }, [session]);

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

  if (sessionLoading || loading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <h2 className="text-2xl font-bold tracking-tight">Pipeline Configuration</h2>

      {/* Pipeline Parameters */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="cfg-runInterval" className="text-sm font-medium">
                Run Interval (minutes)
              </label>
              <Input
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
              <p id="cfg-runInterval-hint" className="text-xs text-muted-foreground">
                15–240 minutes
              </p>
              {fieldErrors.runIntervalMinutes && (
                <p id="cfg-runInterval-error" className="text-xs text-destructive" role="alert">
                  {fieldErrors.runIntervalMinutes}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="cfg-discoveryCap" className="text-sm font-medium">
                Daily Discovery Cap
              </label>
              <Input
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
              <p id="cfg-discoveryCap-hint" className="text-xs text-muted-foreground">
                10–200 prospects per day
              </p>
              {fieldErrors.dailyDiscoveryCap && (
                <p id="cfg-discoveryCap-error" className="text-xs text-destructive" role="alert">
                  {fieldErrors.dailyDiscoveryCap}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="cfg-cadence" className="text-sm font-medium">
                Sequence Cadence (days)
              </label>
              <Input
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
              <p id="cfg-cadence-hint" className="text-xs text-muted-foreground">
                Comma-separated days between follow-ups
              </p>
              {fieldErrors.sequenceCadenceDays && (
                <p id="cfg-cadence-error" className="text-xs text-destructive" role="alert">
                  {fieldErrors.sequenceCadenceDays}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="cfg-maxFollowUps" className="text-sm font-medium">
                Max Follow-Ups
              </label>
              <Input
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
              <p id="cfg-maxFollowUps-hint" className="text-xs text-muted-foreground">
                1–5 follow-ups per prospect
              </p>
              {fieldErrors.maxFollowUps && (
                <p id="cfg-maxFollowUps-error" className="text-xs text-destructive" role="alert">
                  {fieldErrors.maxFollowUps}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="cfg-minLeadScore" className="text-sm font-medium">
                Min Lead Score
              </label>
              <Input
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
              <p id="cfg-minLeadScore-hint" className="text-xs text-muted-foreground">
                30–90 minimum score for outreach
              </p>
              {fieldErrors.minLeadScore && (
                <p id="cfg-minLeadScore-error" className="text-xs text-destructive" role="alert">
                  {fieldErrors.minLeadScore}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="cfg-tone" className="text-sm font-medium">
                Tone Preference
              </label>
              <Select
                value={tonePreference}
                onValueChange={(v) => setTonePreference(v as TonePreference)}
              >
                <SelectTrigger id="cfg-tone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONE_OPTIONS.map((tone) => (
                    <SelectItem key={tone} value={tone}>
                      {tone.charAt(0).toUpperCase() + tone.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strategy Inputs */}
      <Card>
        <CardHeader>
          <CardTitle>Outreach Strategy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="cfg-productContext" className="text-sm font-medium">
              Product Context
            </label>
            <Textarea
              id="cfg-productContext"
              value={productContext}
              onChange={(e) => setProductContext(e.target.value)}
              placeholder="Describe your product, what it does, and who it's for..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="cfg-valueProposition" className="text-sm font-medium">
              Value Proposition
            </label>
            <Textarea
              id="cfg-valueProposition"
              value={valueProposition}
              onChange={(e) => setValueProposition(e.target.value)}
              placeholder="What unique value does your product deliver to prospects?"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="cfg-painPoints" className="text-sm font-medium">
              Target Pain Points
            </label>
            <Input
              id="cfg-painPoints"
              type="text"
              value={targetPainPointsInput}
              onChange={(e) => setTargetPainPointsInput(e.target.value)}
              placeholder="Comma-separated, e.g. slow onboarding, high churn, manual processes"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of pain points your product addresses
            </p>
          </div>
        </CardContent>
      </Card>

      {feedback && (
        <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'} role="status">
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? 'Saving...' : 'Save Configuration'}
      </Button>
    </form>
  );
}
