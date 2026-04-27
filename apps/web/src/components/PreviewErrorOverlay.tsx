import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Sparkles, X, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/utils.js';

/**
 * Captured runtime error from the deployed iframe.
 *
 * The deployed app must be running Argo's observability sidecar (see
 * packages/agent/src/reference/snippets.ts → 'observability-sidecar')
 * which traps window.onerror + unhandledrejection and posts a message
 * to the parent window of the form:
 *
 *   { type: 'argo:runtime-error', message, source, lineno, colno, stack, ts }
 *
 * If the deployed bundle didn't include the sidecar, the overlay
 * silently shows nothing — no false positives, no spurious "errors"
 * from third-party scripts loaded inside the iframe.
 */
export interface CapturedError {
  id: string;
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  ts: number;
}

interface PreviewErrorOverlayProps {
  /**
   * The publicUrl origin we trust messages from. We require message.origin
   * matches this so a malicious page in another tab can't inject "errors"
   * to phish the operator into asking Argo to "fix" something arbitrary.
   */
  publicUrl: string;
  /**
   * Called when the operator clicks "Ask Argo to fix it." The string is a
   * pre-rendered chat prompt embedding the error details so the agent can
   * dispatch this directly to the build pipeline.
   */
  onAskArgo: (prompt: string) => void;
}

/**
 * The runtime-error overlay that floats over the deployed iframe. When
 * the sandboxed page emits `argo:runtime-error` postMessage events, we
 * capture them here, dedupe by error signature, show a stack trace in a
 * collapsible panel, and offer "Ask Argo to fix it" — which constructs
 * a structured prompt and hands it off to the chat send function.
 *
 * Intentionally silent until an error arrives — no scaffolding chrome
 * in the success case.
 */
export function PreviewErrorOverlay({ publicUrl, onAskArgo }: PreviewErrorOverlayProps) {
  const [errors, setErrors] = useState<CapturedError[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  // Allowed origin (used for message.origin === expectedOrigin check).
  const expectedOrigin = (() => {
    try {
      return new URL(publicUrl).origin;
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    if (!expectedOrigin) return;
    function handleMessage(ev: MessageEvent) {
      if (ev.origin !== expectedOrigin) return;
      const data = ev.data as { type?: string; message?: string; source?: string; lineno?: number; colno?: number; stack?: string };
      if (!data || data.type !== 'argo:runtime-error') return;
      if (typeof data.message !== 'string' || data.message.length === 0) return;
      const sig = (data.message + (data.source ?? '') + (data.lineno ?? '')).slice(0, 200);
      setErrors((prev) => {
        // Dedupe: if last error has same signature, ignore.
        if (prev.some((e) => e.message + (e.source ?? '') + (e.lineno ?? '') === sig)) return prev;
        return [
          ...prev,
          {
            id: 'err-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            message: data.message ?? 'Unknown error',
            source: data.source,
            lineno: data.lineno,
            colno: data.colno,
            stack: data.stack,
            ts: Date.now(),
          },
        ].slice(-5); // keep at most 5 distinct errors
      });
      setDismissed(false);
      setExpanded(true);
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [expectedOrigin]);

  // Reset when the iframe source changes.
  useEffect(() => {
    setErrors([]);
    setDismissed(false);
  }, [publicUrl]);

  if (errors.length === 0 || dismissed) return null;

  const last = errors[errors.length - 1];
  if (!last) return null;
  const buildPrompt = () => {
    const lines: string[] = [];
    lines.push("The preview is throwing a runtime error. Here's what the browser caught:");
    lines.push('');
    for (const e of errors) {
      lines.push(`• ${e.message}`);
      if (e.source) lines.push(`  at ${e.source}:${e.lineno ?? '?'}:${e.colno ?? '?'}`);
      if (e.stack) {
        const short = e.stack.split('\n').slice(0, 6).join('\n');
        lines.push('  stack:');
        lines.push(short.split('\n').map((l) => '    ' + l).join('\n'));
      }
    }
    lines.push('');
    lines.push('Please diagnose the cause and apply a surgical fix. After the fix, redeploy.');
    return lines.join('\n');
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="absolute bottom-4 left-4 right-4 z-20 max-w-2xl mx-auto"
      >
        <div
          className={cn(
            'rounded-lg border border-argo-amber/40 bg-argo-bg/95 backdrop-blur-sm shadow-xl',
            'shadow-black/50',
          )}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-argo-border">
            <AlertTriangle className="h-3.5 w-3.5 text-argo-amber flex-shrink-0" />
            <div className="text-xs text-argo-text font-medium flex-1 truncate">
              Runtime error in preview
              {errors.length > 1 ? (
                <span className="text-argo-textSecondary ml-2">+{errors.length - 1} more</span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-argo-textSecondary hover:text-argo-text"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-argo-textSecondary hover:text-argo-text"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {expanded ? (
            <div className="px-3 py-2.5 space-y-2 max-h-64 overflow-y-auto">
              <div className="text-xs text-argo-text font-mono break-words">
                {last.message}
              </div>
              {last.source ? (
                <div className="text-[11px] text-argo-textSecondary font-mono">
                  at {last.source}:{last.lineno ?? '?'}:{last.colno ?? '?'}
                </div>
              ) : null}
              {last.stack ? (
                <details className="text-[11px] text-argo-textSecondary font-mono">
                  <summary className="cursor-pointer hover:text-argo-text">stack trace</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-[10px]">
                    {last.stack.split('\n').slice(0, 8).join('\n')}
                  </pre>
                </details>
              ) : null}
              <div className="pt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => onAskArgo(buildPrompt())}
                  className={cn(
                    'flex items-center gap-1.5 px-3 h-7 rounded text-xs',
                    'bg-argo-accent/15 text-argo-accent hover:bg-argo-accent/25',
                    'transition-colors',
                  )}
                >
                  <Sparkles className="h-3 w-3" />
                  Ask Argo to fix it
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
