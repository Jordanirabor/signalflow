'use client';

import CalendarWeekView from '@/components/CalendarWeekView';
import ConversationView from '@/components/ConversationView';
import CRMPipelineView from '@/components/CRMPipelineView';
import ManualReviewQueue from '@/components/ManualReviewQueue';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function PipelinePage() {
  return (
    <Tabs defaultValue="crm" className="space-y-6">
      <TabsList>
        <TabsTrigger value="crm">CRM Pipeline</TabsTrigger>
        <TabsTrigger value="conversations">Conversations</TabsTrigger>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
        <TabsTrigger value="review">Review Queue</TabsTrigger>
      </TabsList>

      <TabsContent value="crm">
        <CRMPipelineView />
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
    </Tabs>
  );
}
