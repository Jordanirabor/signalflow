'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { useState } from 'react';

const industries = ['B2B SaaS', 'FinTech', 'HealthTech', 'E-commerce', 'DevTools'];
const roles = ['VP of Sales', 'Head of Growth', 'CTO', 'Founder / CEO', 'Marketing Director'];
const companySizes = ['1-10', '11-50', '51-200', '201-500', '500+'];

export function HeroSection() {
  const [industry, setIndustry] = useState('');
  const [role, setRole] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [generated, setGenerated] = useState(false);

  const handleGenerate = () => {
    if (industry && role && companySize) {
      setGenerated(true);
    }
  };

  return (
    <section id="hero" className="min-h-[85vh] bg-background flex items-center">
      <div className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 w-full py-16 md:py-0">
        <div className="flex flex-col md:flex-row md:items-center gap-12 md:gap-8">
          {/* Left side — Value proposition */}
          <div className="md:w-1/2 flex flex-col gap-6">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
              Book qualified sales meetings on autopilot
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-lg">
              Define your ideal customer. We&apos;ll find them, research them, and send emails that
              actually get replies&mdash;no lists, no templates, no manual work.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button asChild>
                <Link href="/api/auth/login">Start your first campaign</Link>
              </Button>
              <Button variant="outline" asChild>
                <a href="#how-it-works">See how it works</a>
              </Button>
            </div>
          </div>

          {/* Right side — ICP generator simulation */}
          <div className="md:w-1/2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">ICP Generator</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Industry select */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Industry</label>
                  <select
                    value={industry}
                    onChange={(e) => {
                      setIndustry(e.target.value);
                      setGenerated(false);
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary"
                  >
                    <option value="">Select industry…</option>
                    {industries.map((i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Role select */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Target Role</label>
                  <select
                    value={role}
                    onChange={(e) => {
                      setRole(e.target.value);
                      setGenerated(false);
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary"
                  >
                    <option value="">Select role…</option>
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Company size select */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Company Size</label>
                  <select
                    value={companySize}
                    onChange={(e) => {
                      setCompanySize(e.target.value);
                      setGenerated(false);
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary"
                  >
                    <option value="">Select size…</option>
                    {companySizes.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <Button
                  className="w-full"
                  onClick={handleGenerate}
                  disabled={!industry || !role || !companySize}
                >
                  Generate ICP
                </Button>

                {/* Mock generated output */}
                {generated && (
                  <div className="rounded-md border border-border bg-muted/40 p-4 space-y-2 text-sm">
                    <p className="font-medium text-foreground">Generated ICP Profile</p>
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Industry:</span> {industry}
                    </p>
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Decision Maker:</span> {role}
                    </p>
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Company Size:</span>{' '}
                      {companySize} employees
                    </p>
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Pain Points:</span> Scaling
                      outbound, lead quality, personalization at scale
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
