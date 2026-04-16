'use client';

import { Header } from '@/components/Header';
import { ProjectSelector } from '@/components/ProjectSelector';
import { Sidebar } from '@/components/Sidebar';
import { Toaster } from '@/components/ui/sonner';
import { ProjectProvider } from '@/contexts/ProjectContext';
import { useState } from 'react';

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <ProjectProvider>
      <div className="flex h-screen">
        <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
        <div className="flex flex-1 flex-col">
          <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
          <div className="flex items-center border-b px-4 py-2">
            <ProjectSelector />
          </div>
          <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
        <Toaster />
      </div>
    </ProjectProvider>
  );
}
