'use client';

import CalendarIntegrationSetup from '@/components/CalendarIntegrationSetup';
import CalendarWeekView from '@/components/CalendarWeekView';
import ConversationView from '@/components/ConversationView';
import EmailIntegrationSetup from '@/components/EmailIntegrationSetup';
import ManualReviewQueue from '@/components/ManualReviewQueue';
import PipelineConfiguration from '@/components/PipelineConfiguration';
import PipelineDashboard from '@/components/PipelineDashboard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function AutopilotPage() {
  return (
    <Tabs defaultValue="dashboard" className="space-y-6">
      <TabsList>
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        <TabsTrigger value="conversations">Conversations</TabsTrigger>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
        <TabsTrigger value="review">Review Queue</TabsTrigger>
        <TabsTrigger value="configuration">Configuration</TabsTrigger>
        <TabsTrigger value="integrations">Integrations</TabsTrigger>
      </TabsList>

      <TabsContent value="dashboard">
        <PipelineDashboard />
      </TabsContent>

      <TabsContent value="conversations">
        <ConversationView />
      </TabsContent>

      <TabsContent value="calendar">
        <CalendarWeekView />
      </TabsContent>

      <TabsContent value="review">
        <ManualReviewQueue />
      </TabsContent>

      <TabsContent value="configuration">
        <PipelineConfiguration />
      </TabsContent>

      <TabsContent value="integrations">
        <div className="space-y-8">
          <CalendarIntegrationSetup />
          <EmailIntegrationSetup />
        </div>
      </TabsContent>
    </Tabs>
  );
}
