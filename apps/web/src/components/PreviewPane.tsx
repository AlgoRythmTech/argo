import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye,
  FileCode2,
  Loader2,
  RefreshCw,
  RotateCw,
  Repeat,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { operations, type GeneratedBundle, type Operation, type PreviewAction } from '../api/client.js';
import { cn } from '../lib/utils.js';

export type PreviewTab = 'preview' | 'code';

interface PreviewPaneProps {
  operation: Operation | null;
}

/**
 * The right-half pane of the workspace center column. Two tabs:
 *
 *   • Preview — iframe of the live Blaxel-hosted operation. Three controls:
 *       refresh (bumps the iframe key), restart (kills + respawns the
 *       node process inside the existing sandbox), rebuild (re-runs the
 *       full build engine and redeploys).
 *
 *   • Code — read-only listing of files in the latest deployed bundle.
 *     Argo's promise is that Maya never opens this; it exists for the
 *     monthly check-in and for security auditors who want to see what
 *     was generated. Each file row shows path, size, sha256-prefix, and
 *     whether the file is `argo:generated` (auto-editable by repair).
 */
export function PreviewPane({ operation }: PreviewPaneProps) {
  const [tab, setTab] = useState<PreviewTab>('preview');
  const [iframeKey, setIframeKey] = useState(0);
  const [busyAction, setBusyAction] = useState<PreviewAction | null>(null);
  const [bundle, setBundle] = useState<GeneratedBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'code' || !operation) return;
    setBundleLoading(true);
    setBundleError(null);
    operations
      .files(operation.id)
      .then((b) => {
        setBundle(b);
        setBundleLoading(false);
      })
      .catch((err) => {
        setBundleError(String(err).slice(0, 200));
        setBundleLoading(false);
      });
  }, [tab, operation?.id]);

  const handleAction = async (action: PreviewAction) => {
    if (!operation) return;
    setBusyAction(action);
    try {
      if (action === 'refresh') {
        setIframeKey((k) => k + 1);
      } else if (action === 'rebuild') {
        await operations.deploy(operation.id);
      } else {
        await operations.previewAction(operation.id, action);
        setIframeKey((k) => k + 1);
      }
    } finally {
      setBusyAction(null);
    }
  };

  if (!operation) {
    return (
      <div className="h-full flex items-center justify-center text-center text-argo-textSecondary px-12 bg-argo-surface/30">
        <div>
          <div className="text-2xl text-argo-text mb-2 argo-hero">Live preview lands here</div>
          <div className="text-sm argo-body">
            Once your workflow is deployed, this pane streams its public form (Blaxel hosts it).
            No code is shown — Maya pastes the URL into her recruiting site.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-argo-surface/30 overflow-hidden">
      <div className="flex items-center justify-between border-b border-argo-border px-3 h-10 flex-shrink-0">
        <div className="flex items-center gap-1">
          <TabButton active={tab === 'preview'} onClick={() => setTab('preview')} icon={<Eye className="h-3.5 w-3.5" />}>
            Preview
          </TabButton>
          <TabButton active={tab === 'code'} onClick={() => setTab('code')} icon={<FileCode2 className="h-3.5 w-3.5" />}>
            Code
          </TabButton>
        </div>
        {tab === 'preview' && (
          <div className="flex items-center gap-1">
            <PreviewControl
              label="Refresh preview"
              busy={busyAction === 'refresh'}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => handleAction('refresh')}
            />
            <PreviewControl
              label="Restart sandbox process"
              busy={busyAction === 'restart'}
              icon={<RotateCw className="h-3.5 w-3.5" />}
              onClick={() => handleAction('restart')}
            />
            <PreviewControl
              label="Rebuild from latest WorkflowMap"
              busy={busyAction === 'rebuild'}
              icon={<Repeat className="h-3.5 w-3.5" />}
              onClick={() => handleAction('rebuild')}
            />
          </div>
        )}
      </div>

      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {tab === 'preview' ? (
            <motion.div
              key="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              {operation.publicUrl ? (
                <iframe
                  key={iframeKey}
                  title="Operation preview"
                  src={operation.publicUrl}
                  className="h-full w-full border-0 bg-white"
                  sandbox="allow-forms allow-scripts allow-same-origin"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-center text-argo-textSecondary px-12">
                  <div className="max-w-sm">
                    <div className="text-lg text-argo-text mb-2 argo-hero">
                      Not deployed yet
                    </div>
                    <div className="text-sm argo-body">
                      Confirm the workflow map and press <span className="text-argo-accent">Go Live</span>.
                      Within ~90 seconds your form will be hosted by Blaxel and reachable here.
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="code"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 overflow-y-auto"
            >
              <CodeSurface bundle={bundle} loading={bundleLoading} error={bundleError} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 h-7 rounded text-xs transition-colors',
        active
          ? 'bg-argo-accent/15 text-argo-accent'
          : 'text-argo-textSecondary hover:text-argo-text hover:bg-argo-surface',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function PreviewControl({
  label,
  icon,
  busy,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={busy}
      className="flex items-center justify-center h-7 w-7 rounded text-argo-textSecondary hover:text-argo-text hover:bg-argo-surface disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
    </button>
  );
}

function CodeSurface({
  bundle,
  loading,
  error,
}: {
  bundle: GeneratedBundle | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-argo-textSecondary text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading bundle…
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-center px-12">
        <div className="max-w-sm">
          <div className="text-argo-amber text-sm mb-2">Couldn't load the bundle.</div>
          <div className="text-argo-textSecondary text-xs font-mono">{error}</div>
        </div>
      </div>
    );
  }
  if (!bundle || bundle.files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-center text-argo-textSecondary px-12">
        <div className="max-w-md">
          <div className="text-argo-text text-lg mb-2 argo-hero">No bundle yet</div>
          <div className="text-sm argo-body">
            Argo writes code only after you confirm the workflow map. The generated files will
            appear here read-only — Maya never opens this surface, but auditors can.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-3 text-xs text-argo-textSecondary font-mono">
        <span>
          v{bundle.version} · {bundle.files.length} files · generated by{' '}
          <span className="text-argo-text">{bundle.generatedByModel}</span>
        </span>
        <span className="flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 text-argo-green" /> read-only audit view
        </span>
      </div>
      <ul className="divide-y divide-argo-border rounded border border-argo-border overflow-hidden">
        {bundle.files.map((f) => (
          <li
            key={f.path}
            className="flex items-center justify-between px-3 py-2 text-sm hover:bg-argo-surface/40"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                title={f.argoGenerated ? 'argo:generated — auto-editable by repair' : 'scaffolding — frozen'}
                className={cn('flex-shrink-0', f.argoGenerated ? 'text-argo-accent' : 'text-argo-textSecondary')}
              >
                {f.argoGenerated ? (
                  <ShieldAlert className="h-3.5 w-3.5" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="font-mono text-argo-text truncate">{f.path}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-argo-textSecondary font-mono flex-shrink-0">
              <span>{prettyBytes(f.size)}</span>
              <span title={f.sha256}>{f.sha256.slice(0, 7)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
