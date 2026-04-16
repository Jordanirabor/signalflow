'use client';

import { PipelinePageContent } from '@/app/pipeline/page';
import CRMPipelineView from '@/components/CRMPipelineView';
import DashboardSummary from '@/components/DashboardSummary';
import ICPForm from '@/components/ICPForm';
import ICPSetManager from '@/components/ICPSetManager';
import InsightForm from '@/components/InsightForm';
import LeadDetailView from '@/components/LeadDetailView';
import LeadListView from '@/components/LeadListView';
import MessageEditor from '@/components/MessageEditor';
import OfflineIndicator from '@/components/OfflineIndicator';
import OutreachTracker from '@/components/OutreachTracker';
import ThrottleConfigUI from '@/components/ThrottleConfig';
import ToastContainer from '@/components/ToastContainer';
import { useToasts } from '@/lib/useErrorHandler';
import { useCallback, useState } from 'react';

type Tab =
  | 'dashboard'
  | 'icp'
  | 'leads'
  | 'pipeline'
  | 'messages'
  | 'outreach'
  | 'insights'
  | 'throttle'
  | 'autopilot';

export default function Home() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [icpSetKey, setIcpSetKey] = useState(0);
  const { toasts, show: showToast, dismiss: dismissToast } = useToasts();

  const handleICPConfirm = useCallback(() => {
    setIcpSetKey((k) => k + 1);
  }, []);

  const handleICPRegenerate = useCallback(() => {
    document.getElementById('icp-generate-section')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  function handleToastLinkClick(linkTo: string) {
    // Navigate to the lead referenced in the toast (e.g. duplicate lead)
    setSelectedLeadId(linkTo);
  }

  if (selectedLeadId) {
    return (
      <div className="app-container">
        <ToastContainer
          toasts={toasts}
          onDismiss={dismissToast}
          onLinkClick={handleToastLinkClick}
        />
        <OfflineIndicator />
        <LeadDetailView leadId={selectedLeadId} onBack={() => setSelectedLeadId(null)} />
      </div>
    );
  }

  return (
    <div className="app-container">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} onLinkClick={handleToastLinkClick} />
      <OfflineIndicator />
      <header className="app-header">
        <h1>SignalFlow</h1>
        <nav className="app-nav" role="tablist" aria-label="Main navigation">
          <button
            role="tab"
            aria-selected={tab === 'dashboard'}
            className={tab === 'dashboard' ? 'tab active' : 'tab'}
            onClick={() => setTab('dashboard')}
          >
            Dashboard
          </button>
          <button
            role="tab"
            aria-selected={tab === 'leads'}
            className={tab === 'leads' ? 'tab active' : 'tab'}
            onClick={() => setTab('leads')}
          >
            Leads
          </button>
          <button
            role="tab"
            aria-selected={tab === 'pipeline'}
            className={tab === 'pipeline' ? 'tab active' : 'tab'}
            onClick={() => setTab('pipeline')}
          >
            Pipeline
          </button>
          <button
            role="tab"
            aria-selected={tab === 'messages'}
            className={tab === 'messages' ? 'tab active' : 'tab'}
            onClick={() => setTab('messages')}
          >
            Messages
          </button>
          <button
            role="tab"
            aria-selected={tab === 'outreach'}
            className={tab === 'outreach' ? 'tab active' : 'tab'}
            onClick={() => setTab('outreach')}
          >
            Outreach
          </button>
          <button
            role="tab"
            aria-selected={tab === 'insights'}
            className={tab === 'insights' ? 'tab active' : 'tab'}
            onClick={() => setTab('insights')}
          >
            Insights
          </button>
          <button
            role="tab"
            aria-selected={tab === 'icp'}
            className={tab === 'icp' ? 'tab active' : 'tab'}
            onClick={() => setTab('icp')}
          >
            ICP
          </button>
          <button
            role="tab"
            aria-selected={tab === 'throttle'}
            className={tab === 'throttle' ? 'tab active' : 'tab'}
            onClick={() => setTab('throttle')}
          >
            Throttle
          </button>
          <button
            role="tab"
            aria-selected={tab === 'autopilot'}
            className={tab === 'autopilot' ? 'tab active' : 'tab'}
            onClick={() => setTab('autopilot')}
          >
            Autopilot
          </button>
        </nav>
      </header>
      <main className="app-main">
        {tab === 'dashboard' && <DashboardSummary />}
        {tab === 'icp' && (
          <>
            <ICPForm onConfirm={handleICPConfirm} />
            <ICPSetManager key={icpSetKey} onRegenerate={handleICPRegenerate} />
          </>
        )}
        {tab === 'leads' && <LeadListView onSelectLead={setSelectedLeadId} />}
        {tab === 'pipeline' && <CRMPipelineView />}
        {tab === 'messages' && <MessageEditor leadId="" />}
        {tab === 'outreach' && <OutreachTracker leadId="" />}
        {tab === 'insights' && <InsightForm leadId="" />}
        {tab === 'throttle' && <ThrottleConfigUI />}
        {tab === 'autopilot' && <PipelinePageContent />}
      </main>
    </div>
  );
}
