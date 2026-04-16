'use client';

import ICPForm from '@/components/ICPForm';
import ICPSetManager from '@/components/ICPSetManager';
import { useCallback, useState } from 'react';

export default function ICPPage() {
  const [icpSetKey, setIcpSetKey] = useState(0);

  const handleICPConfirm = useCallback(() => {
    setIcpSetKey((k) => k + 1);
  }, []);

  const handleICPRegenerate = useCallback(() => {
    document.getElementById('icp-generate-section')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <div className="space-y-8">
      <ICPForm onConfirm={handleICPConfirm} />
      <ICPSetManager key={icpSetKey} onRegenerate={handleICPRegenerate} />
    </div>
  );
}
