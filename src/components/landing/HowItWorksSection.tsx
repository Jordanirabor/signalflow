const steps = [
  { number: 1, title: 'Define your ICP', description: 'Describe your product and target users.' },
  {
    number: 2,
    title: 'Discover leads',
    description: 'Fresh prospects found across the web, every run.',
  },
  {
    number: 3,
    title: 'Deep research',
    description: 'Blogs, interviews, social signals — not just job titles.',
  },
  { number: 4, title: 'Send emails', description: 'Short, human, tied to real pain points.' },
  {
    number: 5,
    title: 'Book meetings',
    description: 'Replies handled, qualified, routed to your calendar.',
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-20">
      <h2 className="text-2xl md:text-3xl font-semibold text-center mb-12">How It Works</h2>

      {/* Desktop: horizontal flow */}
      <div className="hidden md:flex items-start justify-between relative">
        {/* Connecting line */}
        <div className="absolute top-5 left-10 right-10 h-px border-t border-border" />

        {steps.map(({ number, title, description }) => (
          <div key={number} className="relative flex flex-col items-center text-center flex-1 px-2">
            <div className="flex items-center justify-center h-10 w-10 rounded-full border bg-background text-sm font-semibold text-foreground mb-3 z-10">
              {number}
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">{title}</h3>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>

      {/* Mobile: vertical list */}
      <div className="flex flex-col gap-6 md:hidden">
        {steps.map(({ number, title, description }) => (
          <div key={number} className="flex items-start gap-4">
            <div className="flex items-center justify-center h-8 w-8 rounded-full border bg-background text-sm font-semibold text-foreground shrink-0">
              {number}
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground">{title}</h3>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
