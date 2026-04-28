/**
 * VersionTimeline — visual history of every deploy, iteration, and repair.
 *
 * Users can see the entire lifecycle of their operation and click any
 * version to see what changed. This is something no competitor offers —
 * full auditability of AI-generated code changes over time.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  GitBranch,
  Loader2,
  Rocket,
  RotateCw,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import { operations } from '../api/client.js';
import { cn } from '../lib/utils.js';

type VersionEntry = {
  version: number;
  createdAt: string;
  generatedByModel: string;
  aiCycles: number;
};

type DiffSummary = {
  from: number;
  to: number;
  summary: { added: number; removed: number; modified: number; unchanged: number };
};

interface VersionTimelineProps {
  operationId: string;
  currentVersion: number;
  onClose?: () => void;
}

export function VersionTimeline({ operationId, currentVersion, onClose }: VersionTimelineProps) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPair, setSelectedPair] = useState<[number, number] | null>(null);
  const [diffData, setDiffData] = useState<DiffSummary | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [rollingBack, setRollingBack] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    operations
      .bundleVersions(operationId)
      .then((res) => {
        if (!cancelled) {
          setVersions(res.versions);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String((err as Error)?.message ?? err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [operationId]);

  const loadDiff = useCallback(async (from: number, to: number) => {
    setSelectedPair([from, to]);
    setDiffLoading(true);
    try {
      const res = await operations.bundleDiff(operationId, from, to);
      setDiffData({ from, to, summary: res.summary });
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setDiffLoading(false);
    }
  }, [operationId]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-argo-bg">
        <Loader2 className="h-5 w-5 animate-spin text-argo-accent" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-argo-bg overflow-y-auto">
      <header className="flex items-center justify-between border-b border-argo-border px-5 h-12 flex-shrink-0 sticky top-0 bg-argo-bg z-10">
        <div className="flex items-center gap-2 text-argo-text">
          <GitBranch className="h-4 w-4 text-argo-accent" />
          <span className="text-sm font-medium">Version History</span>
          <span className="text-[10px] font-mono text-argo-textSecondary">{versions.length} versions</span>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="text-argo-textSecondary hover:text-argo-text text-xs px-2">
            Close
          </button>
        )}
      </header>

      {error && (
        <div className="border-b border-argo-red/30 bg-argo-red/10 px-4 py-2 text-xs text-argo-red font-mono">
          {error}
        </div>
      )}

      <div className="p-5">
        {versions.length === 0 ? (
          <div className="text-center py-12">
            <GitBranch className="h-8 w-8 text-argo-textSecondary mx-auto mb-3" />
            <p className="text-argo-textSecondary text-sm">No versions yet. Deploy your operation to start tracking history.</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-5 top-0 bottom-0 w-px bg-argo-border" />

            <AnimatePresence initial={false}>
              {versions.map((v, i) => {
                const isCurrent = v.version === currentVersion;
                const isFirst = i === 0;
                const prevVersion = i < versions.length - 1 ? versions[i + 1]!.version : null;

                return (
                  <motion.div
                    key={v.version}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="relative pl-12 pb-6"
                  >
                    {/* Timeline dot */}
                    <div
                      className={cn(
                        'absolute left-[14px] w-[12px] h-[12px] rounded-full border-2',
                        isCurrent
                          ? 'bg-argo-accent border-argo-accent'
                          : 'bg-argo-bg border-argo-border',
                      )}
                    />

                    <div
                      className={cn(
                        'rounded-xl border p-4 transition-colors',
                        isCurrent
                          ? 'border-argo-accent/30 bg-argo-accent/5'
                          : 'border-argo-border hover:bg-argo-surface/50',
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <VersionIcon version={v} isFirst={isFirst} />
                          <span className="text-sm font-semibold text-argo-text">
                            v{v.version}
                          </span>
                          {isCurrent && (
                            <span className="text-[9px] font-mono uppercase tracking-widest text-argo-accent bg-argo-accent/10 border border-argo-accent/20 rounded px-1.5 py-0.5">
                              current
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {prevVersion !== null && (
                            <button
                              type="button"
                              onClick={() => void loadDiff(prevVersion, v.version)}
                              className="text-[10px] text-argo-accent hover:text-argo-accent/80 font-mono"
                            >
                              diff
                            </button>
                          )}
                          {!isCurrent && (
                            <button
                              type="button"
                              onClick={() => setRollingBack(v.version)}
                              disabled={rollingBack !== null}
                              className="text-[10px] text-argo-amber hover:text-argo-amber/80 font-mono disabled:opacity-50"
                            >
                              {rollingBack === v.version ? (
                                <Loader2 className="h-3 w-3 animate-spin inline" />
                              ) : (
                                'rollback'
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-[10px] text-argo-textSecondary font-mono">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(v.createdAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          {v.generatedByModel}
                        </span>
                        {v.aiCycles > 0 && (
                          <span>
                            {v.aiCycles} cycle{v.aiCycles === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>

                      {/* Inline diff summary */}
                      {selectedPair?.[0] === (prevVersion ?? -1) && selectedPair?.[1] === v.version && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="mt-3 pt-3 border-t border-argo-border"
                        >
                          {diffLoading ? (
                            <div className="flex items-center gap-2 text-xs text-argo-textSecondary">
                              <Loader2 className="h-3 w-3 animate-spin" /> Loading diff…
                            </div>
                          ) : diffData ? (
                            <div className="flex items-center gap-3 text-[10px] font-mono">
                              <span className="text-argo-green">+{diffData.summary.added} added</span>
                              <span className="text-argo-amber">~{diffData.summary.modified} modified</span>
                              <span className="text-argo-red">-{diffData.summary.removed} removed</span>
                              <span className="text-argo-textSecondary">{diffData.summary.unchanged} unchanged</span>
                            </div>
                          ) : null}
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

function VersionIcon({ version, isFirst }: { version: VersionEntry; isFirst: boolean }) {
  const model = version.generatedByModel.toLowerCase();
  if (model.includes('iteration')) return <Zap className="h-3.5 w-3.5 text-argo-accent" />;
  if (model.includes('repair')) return <Wrench className="h-3.5 w-3.5 text-argo-amber" />;
  if (isFirst) return <Rocket className="h-3.5 w-3.5 text-argo-green" />;
  return <RotateCw className="h-3.5 w-3.5 text-argo-textSecondary" />;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}
