import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, ArrowRight, ArrowLeft } from 'lucide-react';
import { useArgo } from '../state/store.js';
import { auth, ApiError } from '../api/client.js';
import { Spotlight } from '../components/ui/spotlight.js';
import { LiquidButton } from '../components/ui/liquid-glass-button.js';
import { Input } from '../components/ui/input.js';

export function SignIn() {
  const setView = useArgo((s) => s.setView);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) {
      setStatus('error');
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    setStatus('sending');
    setErrorMessage('');
    try {
      await auth.requestMagicLink(email);
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setErrorMessage(
        err instanceof ApiError && err.code === 'email_domain_not_allowed'
          ? 'That email domain isn\'t enabled yet.'
          : 'Something went wrong. Try again in a moment.',
      );
    }
  }

  return (
    <div className="argo-desktop-only relative h-full bg-argo-bg overflow-hidden flex items-center justify-center">
      <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" fill="#00E5CC" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,229,204,0.05)_0%,transparent_50%)]" />

      <button
        onClick={() => setView('landing')}
        className="absolute top-6 left-6 flex items-center gap-2 text-argo-textSecondary hover:text-argo-text text-sm"
        type="button"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md p-10 rounded-2xl bg-argo-surface/80 border border-argo-border backdrop-blur-md"
      >
        <div className="mb-8 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-argo-accent/15 mb-4">
            <Mail className="h-7 w-7 text-argo-accent" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-argo-text">Sign in to Argo</h1>
          <p className="text-argo-textSecondary mt-2 text-sm">
            We'll email you a one-time link. No passwords, ever.
          </p>
        </div>

        {status === 'sent' ? (
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-argo-green/15 text-argo-green text-sm">
              ✓ Sign-in link sent
            </div>
            <p className="text-argo-textSecondary mt-6 text-sm">
              Check your inbox for an email from <span className="font-mono">argoai@agentmail.to</span>.
              The link expires in 15 minutes.
            </p>
            <button
              onClick={() => setStatus('idle')}
              type="button"
              className="text-argo-accent text-sm mt-6 hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            <div className="pt-3">
              <Input
                label="Work email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === 'sending'}
                autoFocus
              />
            </div>
            {errorMessage && (
              <div className="text-argo-red text-sm">{errorMessage}</div>
            )}
            <LiquidButton
              type="submit"
              size="lg"
              className="w-full bg-argo-accent text-argo-bg font-semibold rounded-md flex items-center justify-center gap-2"
              disabled={status === 'sending'}
            >
              {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
              <ArrowRight className="h-4 w-4" />
            </LiquidButton>
            <p className="text-xs text-argo-textSecondary text-center">
              By signing in you agree to Argo's terms of service and privacy policy.
            </p>
          </form>
        )}
      </motion.div>
    </div>
  );
}
