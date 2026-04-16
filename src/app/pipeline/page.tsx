'use client';

import CalendarIntegrationSetup from '@/components/CalendarIntegrationSetup';
import CalendarWeekView from '@/components/CalendarWeekView';
import ConversationView from '@/components/ConversationView';
import EmailIntegrationSetup from '@/components/EmailIntegrationSetup';
import ManualReviewQueue from '@/components/ManualReviewQueue';
import PipelineConfiguration from '@/components/PipelineConfiguration';
import PipelineDashboard from '@/components/PipelineDashboard';
import { Suspense, useState } from 'react';

type PipelineTab =
  | 'dashboard'
  | 'conversations'
  | 'calendar'
  | 'review'
  | 'configuration'
  | 'integrations';

const PIPELINE_TABS: { key: PipelineTab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'review', label: 'Review Queue' },
  { key: 'configuration', label: 'Configuration' },
  { key: 'integrations', label: 'Integrations' },
];

function TabFallback() {
  return (
    <div className="dashboard-loading" role="status" aria-live="polite">
      Loading...
    </div>
  );
}

export function PipelinePageContent() {
  const [activeTab, setActiveTab] = useState<PipelineTab>('dashboard');

  return (
    <div className="pipeline-page">
      <nav className="pipeline-nav" role="tablist" aria-label="Pipeline navigation">
        {PIPELINE_TABS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            className={activeTab === key ? 'tab active' : 'tab'}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="pipeline-content" role="tabpanel">
        <Suspense fallback={<TabFallback />}>
          {activeTab === 'dashboard' && <PipelineDashboard />}
          {activeTab === 'conversations' && <ConversationView />}
          {activeTab === 'calendar' && <CalendarWeekView />}
          {activeTab === 'review' && <ManualReviewQueue />}
          {activeTab === 'configuration' && <PipelineConfiguration />}
          {activeTab === 'integrations' && (
            <div className="integrations-section">
              <EmailIntegrationSetup />
              <CalendarIntegrationSetup />
            </div>
          )}
        </Suspense>
      </div>
    </div>
  );
}

export default function PipelinePage() {
  return (
    <div className="app-container">
      <header className="app-header">
        <h1>SignalFlow — Autopilot</h1>
      </header>
      <main className="app-main">
        <PipelinePageContent />
      </main>
    </div>
  );
}
