'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/hooks/useSession';
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
  const { session, isLoading: sessionLoading } = useSession();
  const [productDescription, setProductDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

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
          profiles: generatedProfiles,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setFeedback({ type: 'error', message: err.message ?? 'Failed to save ICP set' });
        return;
      }

      setGeneratedProfiles(null);
      setConfirmDialogOpen(false);
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
    setConfirmDialogOpen(false);
  }

  if (sessionLoading) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-24" />
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="space-y-6">
      {/* AI Generation Section */}
      <Card>
        <CardHeader>
          <CardTitle>Generate ICP from Your Product</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Describe what your product does and who it helps. The AI will generate multiple ideal
            customer profiles targeting different buyer personas.
          </p>
          <div className="space-y-2">
            <label htmlFor="icp-productDesc" className="text-sm font-medium">
              Product Description
            </label>
            <Textarea
              id="icp-productDesc"
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              placeholder="e.g. We build an AI-powered code review tool that helps engineering teams catch bugs before they ship. It integrates with GitHub and GitLab and is used by mid-size SaaS companies..."
              rows={4}
            />
          </div>
          <Button
            onClick={handleGenerate}
            disabled={generating || confirming || !productDescription.trim()}
          >
            {generating ? 'Generating ICPs...' : 'Generate ICP with AI'}
          </Button>
        </CardContent>
      </Card>

      {feedback && (
        <Alert variant={feedback.type === 'error' ? 'destructive' : 'default'} role="status">
          <AlertTitle>{feedback.type === 'error' ? 'Error' : 'Success'}</AlertTitle>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}

      {/* Generated profiles preview */}
      {generatedProfiles && generatedProfiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Review Generated Profiles</CardTitle>
            <p className="text-sm text-muted-foreground">
              Your existing ICP set is still active while you review. Confirm to replace it with
              these new profiles.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {generatedProfiles.map((profile, index) => (
                <Card key={index} aria-label={`Preview: ${profile.targetRole}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{profile.targetRole}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-muted-foreground">Industry</span>
                      <p>{profile.industry}</p>
                    </div>
                    {profile.geography && (
                      <div>
                        <span className="font-medium text-muted-foreground">Geography</span>
                        <p>{profile.geography}</p>
                      </div>
                    )}
                    {profile.companyStage && (
                      <div>
                        <span className="font-medium text-muted-foreground">Company Stage</span>
                        <p>{profile.companyStage}</p>
                      </div>
                    )}
                    {profile.painPoints.length > 0 && (
                      <div>
                        <span className="font-medium text-muted-foreground">Pain Points</span>
                        <ul className="ml-4 list-disc">
                          {profile.painPoints.map((pp, i) => (
                            <li key={i}>{pp}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {profile.buyingSignals.length > 0 && (
                      <div>
                        <span className="font-medium text-muted-foreground">Buying Signals</span>
                        <ul className="ml-4 list-disc">
                          {profile.buyingSignals.map((bs, i) => (
                            <li key={i}>{bs}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex gap-2">
              <Button onClick={() => setConfirmDialogOpen(true)} disabled={confirming}>
                {confirming ? 'Saving...' : 'Confirm & Save'}
              </Button>
              <Button variant="outline" onClick={handleCancel} disabled={confirming}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirm Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm ICP Replacement</DialogTitle>
            <DialogDescription>
              This will replace your existing ICP profiles with the {generatedProfiles?.length ?? 0}{' '}
              newly generated profiles. Lead scores will be recalculated. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialogOpen(false)}
              disabled={confirming}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={confirming}>
              {confirming ? 'Saving...' : 'Confirm & Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
