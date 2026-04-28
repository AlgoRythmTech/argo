import { useEffect } from 'react';
import { useArgo } from './state/store.js';
import { auth } from './api/client.js';
import { connectSocket, disconnectSocket } from './state/socket.js';
import { Landing } from './pages/Landing.js';
import { SignIn } from './pages/SignIn.js';
import { Workspace } from './pages/Workspace.js';
import { RepairReview } from './pages/RepairReview.js';
import { Studio } from './pages/Studio.js';
import { RecruitingDemo } from './components/RecruitingDemo.js';
import { Guarantees } from './pages/Guarantees.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { CommandPalette } from './components/CommandPalette.js';
import { OnboardingTour } from './components/OnboardingTour.js';

export function App() {
  const view = useArgo((s) => s.view);
  const setMe = useArgo((s) => s.setMe);

  useEffect(() => {
    let cancelled = false;
    auth
      .me()
      .then((me) => {
        if (cancelled) return;
        setMe(me);
        connectSocket();
      })
      .catch(() => {
        if (cancelled) return;
        // Not signed in — keep landing view.
      });
    return () => {
      cancelled = true;
      disconnectSocket();
    };
  }, [setMe]);

  // Mobile redirect (Section 9 doctrine).
  if (typeof window !== 'undefined' && window.innerWidth < 881) {
    return (
      <div className="argo-mobile-only flex h-full items-center justify-center px-6 text-center">
        <div className="max-w-sm">
          <div className="mb-4 text-3xl font-bold text-argo-accent">Argo</div>
          <p className="text-argo-text text-lg">Argo runs your business.</p>
          <p className="text-argo-textSecondary mt-2 text-sm">
            Check your email — that's where we'll find you.
          </p>
        </div>
      </div>
    );
  }

  // Cmd-K palette is always mounted; it's a no-op until opened.
  const page = (() => {
    switch (view) {
      case 'landing':
        return <Landing />;
      case 'sign-in':
        return <SignIn />;
      case 'workspace':
        return <Workspace />;
      case 'repair-review':
        return <RepairReview />;
      case 'studio':
        return <Studio />;
      case 'demo':
        return <RecruitingDemo />;
      case 'guarantees':
        return <Guarantees />;
      default:
        return <Landing />;
    }
  })();

  return (
    <ErrorBoundary name="app-root">
      {page}
      <CommandPalette />
      {view === 'workspace' && <OnboardingTour />}
    </ErrorBoundary>
  );
}
