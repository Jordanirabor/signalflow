'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">SignalFlow</h1>
        <p className="login-subtitle">GTM Intelligence Engine</p>

        {error && (
          <div className="form-feedback error" role="alert">
            {decodeURIComponent(error)}
          </div>
        )}

        <a href="/api/auth/login" className="login-btn">
          Sign in with ConsentKeys
        </a>

        <p className="login-footer">
          Secure authentication powered by{' '}
          <a href="https://consentkeys.com" target="_blank" rel="noopener noreferrer">
            ConsentKeys
          </a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="login-page">
          <div className="login-card">
            <p>Loading...</p>
          </div>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
