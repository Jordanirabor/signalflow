'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  CallNote,
  CorrelationBreakdown,
  CRMStatus,
  Lead,
  OutreachRecord,
  ResearchProfile,
} from '@/types';
import { useCallback, useEffect, useState } from 'react';

const CRM_STATUSES: CRMStatus[] = ['New', 'Contacted', 'Replied', 'Booked', 'Closed'];

export default function LeadDetailView({ leadId, onBack }: { leadId: string; onBack: () => void }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [outreach, setOutreach] = useState<OutreachRecord[]>([]);
  const [callNotes, setCallNotes] = useState<CallNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<CRMStatus | ''>('');
  const [statusReason, setStatusReason] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [researchProfile, setResearchProfile] = useState<ResearchProfile | null>(null);
  const [correlationData, setCorrelationData] = useState<{
    total: number; breakdown: CorrelationBreakdown; flag: string | null;
  } | null>(null);
  const [refreshingResearch, setRefreshingResearch] = useState(false);
