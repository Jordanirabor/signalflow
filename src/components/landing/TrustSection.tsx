const testimonials = [
  {
    quote:
      'We booked 12 qualified meetings in our first month without writing a single email ourselves.',
    name: 'Alex R.',
    title: 'Founder, SaaS Startup',
  },
  {
    quote:
      'The research quality is unreal. Prospects actually reply because the emails reference real things they care about.',
    name: 'Jamie L.',
    title: 'Head of Growth, Series A',
  },
  {
    quote:
      'I stopped hiring SDRs. Moatify does what a team of three used to do, and the emails are better.',
    name: 'Morgan T.',
    title: 'CEO, B2B Agency',
  },
];

export function TrustSection() {
  return (
    <section id="trust" className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-20">
      <h2 className="text-2xl md:text-3xl font-semibold text-center mb-12">
        Built for founders who need traction fast
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {testimonials.map(({ quote, name, title }) => (
          <div key={name} className="rounded-lg border p-6">
            <p className="text-sm text-muted-foreground mb-4">&ldquo;{quote}&rdquo;</p>
            <p className="text-sm font-medium text-foreground">{name}</p>
            <p className="text-xs text-muted-foreground">{title}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
