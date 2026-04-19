import { Briefcase, Clock, Database, MessageSquare, Sparkles, Target } from 'lucide-react';

const painPoints = [
  { icon: Target, text: "You don't know who to target" },
  { icon: Database, text: 'Your lead lists are stale before you use them' },
  { icon: Sparkles, text: 'Personalization is fake and everyone knows it' },
  { icon: Clock, text: 'Writing emails is a time sink with no guarantee' },
  { icon: MessageSquare, text: 'Replies are inconsistent and hard to manage' },
  { icon: Briefcase, text: 'Outbound becomes a full-time job' },
];

export function ProblemSection() {
  return (
    <section id="problem" className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-20">
      <h2 className="text-2xl md:text-3xl font-semibold text-center mb-12">
        Outbound is broken for founders
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
        {painPoints.map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-start gap-3">
            <Icon className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-foreground">{text}</p>
          </div>
        ))}
      </div>

      <p className="text-lg text-muted-foreground text-center">
        So outbound either doesn&apos;t work&mdash;or becomes a full-time job.
      </p>
    </section>
  );
}
