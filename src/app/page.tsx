import { DeliverabilitySection } from '@/components/landing/DeliverabilitySection';
import { DifferentiationSection } from '@/components/landing/DifferentiationSection';
import { FinalCTASection } from '@/components/landing/FinalCTASection';
import { HeroSection } from '@/components/landing/HeroSection';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { LandingNav } from '@/components/landing/LandingNav';
import { PricingSection } from '@/components/landing/PricingSection';
import { ProblemSection } from '@/components/landing/ProblemSection';
import { SolutionSection } from '@/components/landing/SolutionSection';
import { TrustSection } from '@/components/landing/TrustSection';

export default function Home() {
  return (
    <>
      <LandingNav />
      <main className="pt-16">
        <HeroSection />
        <ProblemSection />
        <SolutionSection />
        <HowItWorksSection />
        <DifferentiationSection />
        <TrustSection />
        <DeliverabilitySection />
        <PricingSection />
        <FinalCTASection />
      </main>
      <LandingFooter />
    </>
  );
}
