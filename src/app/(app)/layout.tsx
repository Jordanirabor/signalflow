'use client';

import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { Toaster } from '@/components/ui/sonner';
import { useState } from 'react';

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen">
      <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex flex-1 flex-col">
        <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-auto p-4">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
