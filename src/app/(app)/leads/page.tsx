'use client';

import LeadDetailView from '@/components/LeadDetailView';
import LeadListView from '@/components/LeadListView';
import { useProject } from '@/contexts/ProjectContext';
import { useState } from 'react';

export default function LeadsPage() {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const { selectedProjectId } = useProject();

  if (selectedLeadId) {
    return <LeadDetailView leadId={selectedLeadId} onBack={() => setSelectedLeadId(null)} />;
  }

  return (
    <LeadListView onSelectLead={(id) => setSelectedLeadId(id)} projectId={selectedProjectId} />
  );
}
