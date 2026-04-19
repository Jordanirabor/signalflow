import Link from 'next/link';

import { Button } from '@/components/ui/button';

const tiers = [
  {
    name: 'Starter',
    price: '$29–79/mo',
    features: ['Solo founder', '1 ICP', 'Limited leads', 'Basic research'],
    cta: 'Get Started',
    variant: 'secondary' as const,
    highlight: false,
  },
  {
    name: 'Growth',
    price: '$99–249/mo',
    features: [
      'Multiple ICPs',
      'Continuous discovery',
      'Deep research',
      'Follow-ups',
      'Calendar booking',
    ],
    cta: 'Start Growing',
    variant: 'default' as const,
    highlight: true,
  },
  {
    name: 'Pro/Scale',
    price: '$299–799/mo',
    features: [
      'Unlimited ICPs',
      'High volume',
      'Priority APIs',
      'Advanced deliverability',
      'CRM integrations',
    ],
    cta: 'Talk to Us',
    variant: 'secondary' as const,
    highlight: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-20">
      <h2 className="text-2xl md:text-3xl font-semibold text-center mb-12">
        Simple, outcome-based pricing
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {tiers.map(({ name, price, features, cta, variant, highlight }) => (
          <div
            key={name}
            className={`rounded-lg border p-6 flex flex-col${highlight ? ' ring-1 ring-accent' : ''}`}
          >
            <h3 className="text-lg font-semibold text-foreground mb-1">{name}</h3>
            <p className="text-2xl font-bold text-foreground mb-4">{price}</p>
            <ul className="space-y-2 mb-6 flex-1">
              {features.map((feature) => (
                <li key={feature} className="text-sm text-muted-foreground">
                  {feature}
                </li>
              ))}
            </ul>
            <Button variant={variant} className="w-full" asChild>
              <Link href="/api/auth/login">{cta}</Link>
            </Button>
          </div>
        ))}
      </div>

      <p className="text-sm text-muted-foreground text-center mt-8">
        Optional add-on: pay-per-meeting or success-based pricing
      </p>
    </section>
  );
}
