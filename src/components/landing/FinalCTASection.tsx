import Link from 'next/link';

import { Button } from '@/components/ui/button';

export function FinalCTASection() {
  return (
    <section id="final-cta" className="bg-muted">
      <div className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-20 text-center">
        <h2 className="text-2xl md:text-3xl font-semibold mb-8">
          Your outbound shouldn&apos;t depend on how much time you have
        </h2>
        <Button asChild>
          <Link href="/api/auth/login">Start your first campaign</Link>
        </Button>
      </div>
    </section>
  );
}
