'use client';

import LeadDetailView from '@/components/LeadDetailView';
import LeadListView from '@/components/LeadListView';
import { useState } from 'react';

export default function LeadsPage() {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  if (selectedLeadId) {
    return <LeadDetailView leadId={selectedLeadId} onBack={() => setSelectedLeadId(null)} />;
  }

  return <LeadListView onSelectLead={(id) => setSelectedLeadId(id)} />;
}
