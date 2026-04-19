const rows = [
  { feature: 'Lead sourcing', most: 'Static databases', moatify: 'Live web discovery' },
  {
    feature: 'Research',
    most: 'Job title + company size',
    moatify: 'Blogs, interviews, social signals',
  },
  {
    feature: 'Emails',
    most: 'Templates with merge tags',
    moatify: 'Unique, research-backed messages',
  },
  { feature: 'Follow-ups', most: 'Timed sequences', moatify: 'Reply-aware, context-driven' },
  { feature: 'Outcome', most: 'More emails sent', moatify: 'More meetings booked' },
];

export function DifferentiationSection() {
  return (
    <section id="differentiation" className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-20">
      <h2 className="text-2xl md:text-3xl font-semibold text-center mb-12">
        Why This Is Different
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left text-sm font-medium text-muted-foreground py-3 px-4 w-1/3">
                Feature
              </th>
              <th className="text-left text-sm font-medium text-muted-foreground py-3 px-4 w-1/3">
                Most tools
              </th>
              <th className="text-left text-sm font-medium text-foreground py-3 px-4 w-1/3">
                Moatify
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ feature, most, moatify }) => (
              <tr key={feature} className="border-b transition-colors hover:bg-muted/50">
                <td className="py-3 px-4 text-sm font-medium text-foreground">{feature}</td>
                <td className="py-3 px-4 text-sm text-muted-foreground">{most}</td>
                <td className="py-3 px-4 text-sm font-medium text-foreground">{moatify}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
