// Bundle diff viewer — "what changed in v3 vs v2".
//
// Layout: from/to dropdowns at the top, a summary chip row (added /
// removed / modified / unchanged), a left-pane file list grouped by
// change kind, and a right-pane unified diff for the active file. The
// diff itself is computed client-side via a tiny Myers-LCS implementation
// that returns line-level chunks; line numbers + colour-coded gutters
// give it the IDE-grade feel.

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeftRight, FileMinus, FilePlus, FilePen, Loader2 } from 'lucide-react';
import { operations } from '../api/client.js';
import { cn } from '../lib/utils.js';

interface BundleDiffViewerProps {
  operationId: string;
  /** Optional default versions; if omitted, picks the two newest. */
  defaultFrom?: number;
  defaultTo?: number;
}

interface DiffEntry {
  path: string;
  change: 'added' | 'removed' | 'modified' | 'unchanged';
  fromSha: string | null;
  toSha: string | null;
  fromContents?: string;
  toContents?: string;
}

export function BundleDiffViewer({ operationId, defaultFrom, defaultTo }: BundleDiffViewerProps) {
  const [versions, setVersions] = useState<Array<{ version: number; createdAt: string; generatedByModel: string; aiCycles: number }>>([]);
  const [from, setFrom] = useState<number | null>(defaultFrom ?? null);
  const [to, setTo] = useState<number | null>(defaultTo ?? null);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffs, setDiffs] = useState<DiffEntry[] | null>(null);
  const [summary, setSummary] = useState<{ added: number; removed: number; modified: number; unchanged: number } | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);

  // Load versions on mount.
  useEffect(() => {
    let cancelled = false;
    setLoadingVersions(true);
    operations
      .bundleVersions(operationId)
      .then((res) => {
        if (cancelled) return;
        setVersions(res.versions);
        if (res.versions.length >= 2) {
          setFrom((v) => v ?? res.versions[1]!.version);
          setTo((v) => v ?? res.versions[0]!.version);
        } else if (res.versions.length === 1) {
          setFrom(res.versions[0]!.version);
          setTo(res.versions[0]!.version);
        }
        setLoadingVersions(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadingVersions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [operationId]);

  // Load diff when from/to change.
  useEffect(() => {
    if (from === null || to === null) return;
    let cancelled = false;
    setLoadingDiff(true);
    operations
      .bundleDiff(operationId, from, to)
      .then((res) => {
        if (cancelled) return;
        setDiffs(res.diffs);
        setSummary(res.summary);
        // Default-select the first changed file.
        const firstChanged = res.diffs.find((d) => d.change !== 'unchanged');
        setActivePath(firstChanged?.path ?? res.diffs[0]?.path ?? null);
        setLoadingDiff(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadingDiff(false);
      });
    return () => {
      cancelled = true;
    };
  }, [operationId, from, to]);

  const visibleDiffs = useMemo(() => {
    if (!diffs) return [];
    return showUnchanged ? diffs : diffs.filter((d) => d.change !== 'unchanged');
  }, [diffs, showUnchanged]);

  const active = useMemo(
    () => (activePath && diffs ? diffs.find((d) => d.path === activePath) ?? null : null),
    [diffs, activePath],
  );

  const lineDiff = useMemo(() => {
    if (!active) return null;
    const a = (active.fromContents ?? '').split('\n');
    const b = (active.toContents ?? '').split('\n');
    return computeLineDiff(a, b);
  }, [active]);

  if (loadingVersions) {
    return (
      <div className="h-full flex items-center justify-center text-argo-textSecondary text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading versions…
      </div>
    );
  }
  if (versions.length < 2) {
    return (
      <div className="h-full flex items-center justify-center text-center text-argo-textSecondary px-12">
        <div className="max-w-md">
          <div className="text-argo-text text-lg mb-2 argo-hero">Need two versions to diff</div>
          <div className="text-sm argo-body">
            Argo persists every deploy as a new bundle. Once you've deployed twice, this view shows
            exactly what changed between any two versions.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-argo-bg overflow-hidden">
      <header className="flex items-center justify-between border-b border-argo-border px-4 h-12 flex-shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <VersionPicker
            versions={versions}
            value={from}
            onChange={setFrom}
            label="From"
          />
          <ArrowLeftRight className="h-3.5 w-3.5 text-argo-textSecondary" />
          <VersionPicker versions={versions} value={to} onChange={setTo} label="To" />
        </div>
        {summary && (
          <div className="flex items-center gap-2 text-xs font-mono text-argo-textSecondary">
            <SummaryChip kind="added" n={summary.added} />
            <SummaryChip kind="removed" n={summary.removed} />
            <SummaryChip kind="modified" n={summary.modified} />
            <button
              type="button"
              onClick={() => setShowUnchanged((v) => !v)}
              className="text-[10px] uppercase tracking-widest text-argo-textSecondary hover:text-argo-text"
            >
              {showUnchanged ? 'hide' : 'show'} unchanged ({summary.unchanged})
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* File list */}
        <aside className="w-72 flex-shrink-0 border-r border-argo-border overflow-y-auto py-2">
          {loadingDiff ? (
            <div className="text-argo-textSecondary text-xs text-center py-12">
              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
            </div>
          ) : (
            <ul className="space-y-0.5">
              {visibleDiffs.map((d) => (
                <li key={d.path}>
                  <button
                    type="button"
                    onClick={() => setActivePath(d.path)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1 text-xs rounded',
                      activePath === d.path
                        ? 'bg-argo-accent/15 text-argo-accent'
                        : 'text-argo-textSecondary hover:text-argo-text hover:bg-argo-surface/50',
                    )}
                  >
                    <ChangeIcon change={d.change} />
                    <span className="font-mono truncate">{d.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Diff body */}
        <div className="flex-1 overflow-auto bg-[#0a0a0b] font-mono text-[12px] leading-[1.6]">
          <AnimatePresence mode="wait">
            {!active ? (
              <div className="h-full flex items-center justify-center text-argo-textSecondary text-xs">
                Select a file to see the diff.
              </div>
            ) : active.change === 'unchanged' ? (
              <div className="h-full flex items-center justify-center text-argo-textSecondary text-xs">
                No changes between v{from} and v{to} for this file.
              </div>
            ) : (
              <motion.div
                key={active.path}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
                className="px-0 py-3"
              >
                {lineDiff ? (
                  <table className="w-full">
                    <tbody>
                      {lineDiff.map((line, i) => (
                        <tr
                          key={i}
                          className={cn(
                            line.kind === 'add' && 'bg-argo-green/10',
                            line.kind === 'del' && 'bg-argo-red/10',
                          )}
                        >
                          <td className="select-none text-right pr-2 pl-3 w-10 text-argo-textSecondary/60">
                            {line.fromLine ?? ''}
                          </td>
                          <td className="select-none text-right pr-3 w-10 text-argo-textSecondary/60">
                            {line.toLine ?? ''}
                          </td>
                          <td
                            className={cn(
                              'pl-2 pr-1 select-none',
                              line.kind === 'add' && 'text-argo-green',
                              line.kind === 'del' && 'text-argo-red',
                              line.kind === 'eq' && 'text-argo-textSecondary',
                            )}
                          >
                            {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                          </td>
                          <td className="pr-4 text-argo-text whitespace-pre">
                            {line.content || ' '}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function VersionPicker({
  versions,
  value,
  onChange,
  label,
}: {
  versions: Array<{ version: number; createdAt: string; generatedByModel: string; aiCycles: number }>;
  value: number | null;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-1 text-xs text-argo-textSecondary">
      <span className="uppercase tracking-widest text-[10px]">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-argo-surface border border-argo-border rounded px-2 py-1 text-argo-text text-xs font-mono"
      >
        {versions.map((v) => (
          <option key={v.version} value={v.version}>
            v{v.version} · {new Date(v.createdAt).toLocaleDateString()} · {v.generatedByModel}
          </option>
        ))}
      </select>
    </label>
  );
}

function SummaryChip({ kind, n }: { kind: 'added' | 'removed' | 'modified'; n: number }) {
  const tone =
    kind === 'added'
      ? 'border-argo-green/40 text-argo-green bg-argo-green/10'
      : kind === 'removed'
      ? 'border-argo-red/40 text-argo-red bg-argo-red/10'
      : 'border-argo-amber/40 text-argo-amber bg-argo-amber/10';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5', tone)}>
      <span className="uppercase tracking-widest text-[10px]">{kind}</span>
      <span>{n}</span>
    </span>
  );
}

function ChangeIcon({ change }: { change: DiffEntry['change'] }) {
  if (change === 'added') return <FilePlus className="h-3 w-3 text-argo-green flex-shrink-0" />;
  if (change === 'removed') return <FileMinus className="h-3 w-3 text-argo-red flex-shrink-0" />;
  if (change === 'modified') return <FilePen className="h-3 w-3 text-argo-amber flex-shrink-0" />;
  return <span className="h-3 w-3 flex-shrink-0" />;
}

// ── Diff algorithm: Myers-style LCS over lines. Plenty fast for typical
//    bundle files (<5K lines). For huge files we degrade gracefully.
type DiffLine =
  | { kind: 'eq'; content: string; fromLine: number; toLine: number }
  | { kind: 'add'; content: string; fromLine: null; toLine: number }
  | { kind: 'del'; content: string; fromLine: number; toLine: null };

function computeLineDiff(a: string[], b: string[]): DiffLine[] {
  const N = a.length;
  const M = b.length;
  if (N + M > 20_000) {
    // Bail to a naive line-by-line diff for huge files.
    const out: DiffLine[] = [];
    const max = Math.max(N, M);
    for (let i = 0; i < max; i++) {
      if (i < N && i < M && a[i] === b[i]) out.push({ kind: 'eq', content: a[i]!, fromLine: i + 1, toLine: i + 1 });
      else {
        if (i < N) out.push({ kind: 'del', content: a[i]!, fromLine: i + 1, toLine: null });
        if (i < M) out.push({ kind: 'add', content: b[i]!, fromLine: null, toLine: i + 1 });
      }
    }
    return out;
  }

  // LCS DP table.
  const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));
  for (let i = N - 1; i >= 0; i--) {
    for (let j = M - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  // Walk to produce the diff.
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < N && j < M) {
    if (a[i] === b[j]) {
      out.push({ kind: 'eq', content: a[i]!, fromLine: i + 1, toLine: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: 'del', content: a[i]!, fromLine: i + 1, toLine: null });
      i++;
    } else {
      out.push({ kind: 'add', content: b[j]!, fromLine: null, toLine: j + 1 });
      j++;
    }
  }
  while (i < N) out.push({ kind: 'del', content: a[i]!, fromLine: ++i, toLine: null });
  while (j < M) out.push({ kind: 'add', content: b[j]!, fromLine: null, toLine: ++j });
  return out;
}
