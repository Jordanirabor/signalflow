'use client';

import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { MobileMenu } from './MobileMenu';

export function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav
      aria-label="Main navigation"
      className="fixed top-0 w-full z-50 bg-background border-b border-border"
    >
      <div className="max-w-5xl mx-auto px-4 md:px-6 flex items-center justify-between h-16">
        {/* Logo */}
        <span className="font-semibold text-lg">Moatify</span>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          <a
            href="#how-it-works"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            How It Works
          </a>
          <a
            href="#pricing"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Pricing
          </a>
          <a
            href="/api/auth/login"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign In
          </a>
          <Button asChild>
            <Link href="/api/auth/login">Start your first campaign</Link>
          </Button>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      <MobileMenu open={mobileOpen} onOpenChange={setMobileOpen} />
    </nav>
  );
}
