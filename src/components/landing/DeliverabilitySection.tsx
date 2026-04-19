import { Clock, Flame, Gauge, MessageSquare } from 'lucide-react';

const features = [
  {
    icon: Gauge,
    title: 'Smart rate limiting',
    description: 'Automatically adjusts sending speed to protect your reputation.',
  },
  {
    icon: Flame,
    title: 'Sending warm-up',
    description: 'Gradually increases volume to build domain trust.',
  },
  {
    icon: Clock,
    title: 'Human-like patterns',
    description: 'Randomized timing that mimics real human behavior.',
  },
  {
    icon: MessageSquare,
    title: 'Reply-aware follow-ups',
    description: 'Stops sequences when prospects engage.',
  },
];

export function DeliverabilitySection() {
  return (
    <section id="deliverability" className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-20">
      <h2 className="text-2xl md:text-3xl font-semibold text-center mb-12">
        Built to protect your domain
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {features.map(({ icon: Icon, title, description }) => (
          <div key={title} className="rounded-lg border p-6">
            <Icon className="h-5 w-5 text-muted-foreground mb-3" />
            <h3 className="text-base font-medium text-foreground mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
