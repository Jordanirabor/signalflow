'use client';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Bot,
  Gauge,
  Kanban,
  LayoutDashboard,
  Lightbulb,
  MessageSquare,
  Send,
  Target,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard /> },
  { label: 'Leads', href: '/leads', icon: <Users /> },
  { label: 'Pipeline', href: '/pipeline', icon: <Kanban /> },
  { label: 'Messages', href: '/messages', icon: <MessageSquare /> },
  { label: 'Outreach', href: '/outreach', icon: <Send /> },
  { label: 'Insights', href: '/insights', icon: <Lightbulb /> },
  { label: 'ICP', href: '/icp', icon: <Target /> },
  { label: 'Throttle', href: '/throttle', icon: <Gauge /> },
  { label: 'Autopilot', href: '/autopilot', icon: <Bot /> },
];

export interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-4">
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Button
            key={item.href}
            variant="ghost"
            className={`justify-start gap-3 ${isActive ? 'bg-primary/8 text-primary' : ''}`}
            asChild
          >
            <Link href={item.href}>
              {item.icon}
              {item.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

export function Sidebar({ isOpen, onToggle }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:bg-muted/40">
        <div className="px-4 py-3 font-semibold text-lg tracking-tight text-primary">
          SignalFlow
        </div>
        <Separator />
        <SidebarNav />
      </aside>

      {/* Mobile sidebar via Sheet */}
      <Sheet open={isOpen} onOpenChange={onToggle}>
        <SheetContent side="left" className="w-60 p-0">
          <SheetHeader className="px-4 py-3">
            <SheetTitle>SignalFlow</SheetTitle>
          </SheetHeader>
          <Separator />
          <SidebarNav />
        </SheetContent>
      </Sheet>
    </>
  );
}
