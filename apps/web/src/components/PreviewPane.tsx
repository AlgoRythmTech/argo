import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  Diff,
  Eye,
  FileCode2,
  Inbox,
  Key,
  Loader2,
  Monitor,
  RefreshCw,
  RotateCw,
  Repeat,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tablet,
  Terminal,
  Zap,
} from 'lucide-react';
import { operations, type GeneratedBundle, type Operation, type PreviewAction } from '../api/client.js';
import { CodeViewer } from './CodeViewer.js';
import { BundleDiffViewer } from './BundleDiffViewer.js';
import { ReplayPanel } from './ReplayPanel.js';
import { NotificationsInbox } from './NotificationsInbox.js';
import { MemoryPanel } from './MemoryPanel.js';
import { EnvVarsPanel } from './EnvVarsPanel.js';
import { LogsViewer } from './LogsViewer.js';
import { IterationPanel } from './IterationPanel.js';
import { PreviewErrorOverlay } from './PreviewErrorOverlay.js';
import { WorkflowAutomation } from './WorkflowAutomation.js';
import { PipelineVisualization } from './PipelineVisualization.js';
import { GuardrailsDashboard } from './GuardrailsDashboard.js';
import { DataBrowser } from './DataBrowser.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { cn } from '../lib/utils.js';

export type PreviewTab = 'preview' | 'code' | 'diff' | 'replay' | 'inbox' | 'memory' | 'env' | 'logs' | 'iterate' | 'workflow' | 'pipeline' | 'guardrails' | 'data' | 'export' | 'domains';

interface PreviewPaneProps {
  operation: Operation | null;
  /**
   * Optional callback invoked when the preview-error overlay's
   * "Ask Argo to fix it" button is clicked. The handler should send
   * the prompt to the chat send pipeline. If omitted, the button is
   * still rendered but the overlay falls back to copying to clipboard.
   */
  onAskArgo?: (prompt: string) => void;
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
type DeviceFrame = 'desktop' | 'tablet' | 'mobile';

const DEVICE_DIMENSIONS: Record<DeviceFrame, { width: number; height: number; label: string }> = {
  desktop: { width: 1280, height: 800, label: '1280 × 800' },
  tablet: { width: 768, height: 1024, label: 'iPad' },
  mobile: { width: 390, height: 844, label: 'iPhone 14' },
};

export function PreviewPane({ operation, onAskArgo }: PreviewPaneProps) {
  const [tab, setTab] = useState<PreviewTab>('preview');
  const [iframeKey, setIframeKey] = useState(0);
  const [busyAction, setBusyAction] = useState<PreviewAction | null>(null);
  const [bundle, setBundle] = useState<GeneratedBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceFrame>('desktop');

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
          <TabButton active={tab === 'diff'} onClick={() => setTab('diff')} icon={<Diff className="h-3.5 w-3.5" />}>
            Diff
          </TabButton>
          <TabButton active={tab === 'replay'} onClick={() => setTab('replay')} icon={<Sparkles className="h-3.5 w-3.5" />}>
            Replay
          </TabButton>
          <TabButton active={tab === 'inbox'} onClick={() => setTab('inbox')} icon={<Inbox className="h-3.5 w-3.5" />}>
            Inbox
          </TabButton>
          <TabButton active={tab === 'memory'} onClick={() => setTab('memory')} icon={<Brain className="h-3.5 w-3.5" />}>
            Memory
          </TabButton>
          <TabButton active={tab === 'env'} onClick={() => setTab('env')} icon={<Key className="h-3.5 w-3.5" />}>
            Env
          </TabButton>
          <TabButton active={tab === 'logs'} onClick={() => setTab('logs')} icon={<Terminal className="h-3.5 w-3.5" />}>
            Logs
          </TabButton>
          <TabButton active={tab === 'iterate'} onClick={() => setTab('iterate')} icon={<Zap className="h-3.5 w-3.5" />}>
            Iterate
          </TabButton>
          <TabButton active={tab === 'workflow'} onClick={() => setTab('workflow')} icon={<Repeat className="h-3.5 w-3.5" />}>
            Flow
          </TabButton>
          <TabButton active={tab === 'pipeline'} onClick={() => setTab('pipeline')} icon={<ShieldCheck className="h-3.5 w-3.5" />}>
            Pipeline
          </TabButton>
          <TabButton active={tab === 'guardrails'} onClick={() => setTab('guardrails')} icon={<ShieldCheck className="h-3.5 w-3.5" />}>
            Guards
          </TabButton>
          <TabButton active={tab === 'data'} onClick={() => setTab('data')} icon={<Inbox className="h-3.5 w-3.5" />}>
            Data
          </TabButton>
        </div>
        {tab === 'preview' && (
          <div className="flex items-center gap-3">
            <DeviceToggle current={device} onChange={setDevice} />
            <div className="h-4 w-px bg-argo-border" />
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
                label="Rebuild from latest scope"
                busy={busyAction === 'rebuild'}
                icon={<Repeat className="h-3.5 w-3.5" />}
                onClick={() => handleAction('rebuild')}
              />
            </div>
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
                <>
                  <DeviceFramedIframe
                    key={`${iframeKey}-${device}`}
                    src={operation.publicUrl}
                    device={device}
                  />
                  <PreviewErrorOverlay
                    publicUrl={operation.publicUrl}
                    onAskArgo={(prompt) => {
                      if (onAskArgo) {
                        onAskArgo(prompt);
                      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
                        void navigator.clipboard.writeText(prompt);
                      }
                    }}
                  />
                </>
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
          ) : tab === 'diff' ? (
            <motion.div
              key="diff"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              <BundleDiffViewer operationId={operation.id} />
            </motion.div>
          ) : tab === 'replay' ? (
            <motion.div
              key="replay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              <ReplayPanel operationId={operation.id} />
            </motion.div>
          ) : tab === 'inbox' ? (
            <motion.div
              key="inbox"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              <NotificationsInbox />
            </motion.div>
          ) : tab === 'memory' ? (
            <motion.div
              key="memory"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              <MemoryPanel operationId={operation.id} />
            </motion.div>
          ) : tab === 'env' ? (
            <motion.div
              key="env"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              <EnvVarsPanel operationId={operation.id} />
            </motion.div>
          ) : tab === 'logs' ? (
            <motion.div
              key="logs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              <LogsViewer operationId={operation.id} />
            </motion.div>
          ) : tab === 'iterate' ? (
            <motion.div
              key="iterate"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              <IterationPanel operationId={operation.id} operationName={operation.name} />
            </motion.div>
          ) : tab === 'workflow' ? (
            <motion.div
              key="workflow"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 overflow-y-auto"
            >
              <WorkflowAutomation operationId={operation.id} />
            </motion.div>
          ) : tab === 'pipeline' ? (
            <motion.div
              key="pipeline"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 overflow-y-auto"
            >
              <PipelineVisualization operationId={operation.id} />
            </motion.div>
          ) : tab === 'guardrails' ? (
            <motion.div
              key="guardrails"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 overflow-y-auto"
            >
              <GuardrailsDashboard operationId={operation.id} />
            </motion.div>
          ) : tab === 'data' ? (
            <motion.div
              key="data"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 overflow-y-auto"
            >
              <ErrorBoundary name="data-browser">
                <DataBrowser operationId={operation.id} />
              </ErrorBoundary>
            </motion.div>
          ) : (
            <motion.div
              key="code"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              {bundleLoading ? (
                <div className="h-full flex items-center justify-center text-argo-textSecondary text-sm">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading bundle…
                </div>
              ) : bundleError ? (
                <div className="h-full flex items-center justify-center text-center px-12">
                  <div className="max-w-sm">
                    <div className="text-argo-amber text-sm mb-2">Couldn't load the bundle.</div>
                    <div className="text-argo-textSecondary text-xs font-mono">{bundleError}</div>
                  </div>
                </div>
              ) : !bundle || bundle.files.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-argo-textSecondary px-12">
                  <div className="max-w-md">
                    <div className="text-argo-text text-lg mb-2 argo-hero">No bundle yet</div>
                    <div className="text-sm argo-body">
                      Argo writes code only after you confirm the workflow. The generated files will
                      appear here read-only — operators rarely open it; auditors do.
                    </div>
                  </div>
                </div>
              ) : (
                <CodeViewer operationId={operation.id} bundle={bundle} />
              )}
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

function DeviceToggle({
  current,
  onChange,
}: {
  current: DeviceFrame;
  onChange: (d: DeviceFrame) => void;
}) {
  const buttons: Array<{ d: DeviceFrame; icon: typeof Monitor; label: string }> = [
    { d: 'desktop', icon: Monitor, label: 'Desktop' },
    { d: 'tablet', icon: Tablet, label: 'Tablet' },
    { d: 'mobile', icon: Smartphone, label: 'Mobile' },
  ];
  return (
    <div className="inline-flex items-center rounded border border-argo-border bg-argo-bg/40 p-0.5">
      {buttons.map((b) => {
        const Icon = b.icon;
        const active = current === b.d;
        return (
          <button
            key={b.d}
            type="button"
            title={`${b.label} (${DEVICE_DIMENSIONS[b.d].label})`}
            aria-label={b.label}
            aria-pressed={active}
            onClick={() => onChange(b.d)}
            className={cn(
              'inline-flex items-center justify-center h-6 w-7 rounded-sm transition-colors',
              active
                ? 'bg-argo-accent/15 text-argo-accent'
                : 'text-argo-textSecondary hover:text-argo-text',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Renders the customer-deployed preview inside a device-shaped frame so the
 * operator can sanity-check responsive behaviour. Desktop = full bleed;
 * tablet/mobile use a centred fixed-size container with a soft chrome.
 */
function DeviceFramedIframe({ src, device }: { src: string; device: DeviceFrame }) {
  if (device === 'desktop') {
    return (
      <iframe
        title="Operation preview"
        src={src}
        className="h-full w-full border-0 bg-white"
        sandbox="allow-forms allow-scripts allow-same-origin"
      />
    );
  }
  const dim = DEVICE_DIMENSIONS[device];
  return (
    <div className="h-full w-full flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(0,229,204,0.04),transparent_70%)] p-6 overflow-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="relative rounded-[28px] border border-argo-border bg-argo-bg/40 shadow-2xl shadow-black/40 p-2"
        style={{ width: dim.width + 16, height: dim.height + 16 }}
      >
        <iframe
          title="Operation preview"
          src={src}
          className="block h-full w-full rounded-[20px] border-0 bg-white"
          sandbox="allow-forms allow-scripts allow-same-origin"
          style={{ width: dim.width, height: dim.height }}
        />
        <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono">
          {device} · {dim.label}
        </div>
      </motion.div>
    </div>
  );
}
