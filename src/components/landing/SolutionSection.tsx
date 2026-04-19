const cards = [
  { before: 'List building', after: 'Continuous discovery' },
  { before: 'Copywriting', after: 'Research-backed emails' },
  { before: 'Manual research', after: 'Deep automated analysis' },
  { before: 'Campaign babysitting', after: 'Autonomous follow-up' },
];

export function SolutionSection() {
  return (
    <section id="solution" className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-20">
      <h2 className="text-2xl md:text-3xl font-semibold text-center mb-12">
        This is outbound, rebuilt from scratch
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {cards.map(({ before, after }) => (
          <div key={before} className="rounded-lg border p-6">
            <p className="text-sm text-muted-foreground mb-2">{before}</p>
            <p className="text-base font-medium text-foreground">{after}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
