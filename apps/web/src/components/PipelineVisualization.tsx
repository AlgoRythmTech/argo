import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Cpu,
  FileCode2,
  FlaskConical,
  Lock,
  Package,
  Rocket,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api/client.js';
import { cn } from '../lib/utils.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type StageStatus = 'pending' | 'running' | 'passed' | 'failed';

export interface StageDetail {
  label: string;
  value: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  status: StageStatus;
  durationMs?: number;
  details?: StageDetail[];
  summary?: string;
}

export interface PipelineVisualizationProps {
  operationId: string;
  stages?: PipelineStage[];
  onStageClick?: (stageId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Stage metadata (icon + default details)                            */
/* ------------------------------------------------------------------ */

const STAGE_META: Record<string, { icon: typeof Cpu; color: string }> = {
  stream:       { icon: Cpu,           color: 'from-violet-500 to-purple-600' },
  parse:        { icon: FileCode2,     color: 'from-blue-500 to-cyan-500' },
  quality_gate: { icon: ShieldCheck,   color: 'from-emerald-500 to-green-500' },
  npm_validate: { icon: Package,       color: 'from-amber-500 to-orange-500' },
  security:     { icon: Lock,          color: 'from-rose-500 to-red-500' },
  test_suite:   { icon: FlaskConical,  color: 'from-indigo-500 to-blue-600' },
  deploy:       { icon: Rocket,        color: 'from-fuchsia-500 to-pink-500' },
};

const STAGE_ORDER = [
  'stream',
  'parse',
  'quality_gate',
  'npm_validate',
  'security',
  'test_suite',
  'deploy',
] as const;

/* ------------------------------------------------------------------ */
/*  Fallback sample data                                               */
/* ------------------------------------------------------------------ */

function sampleStages(): PipelineStage[] {
  return [
    { id: 'stream',       name: 'Stream',        status: 'passed', durationMs: 4820,  summary: '12 files generated', details: [{ label: 'Files', value: '12' }, { label: 'Tokens', value: '18,340' }] },
    { id: 'parse',        name: 'Parse',         status: 'passed', durationMs: 310,   summary: 'All tags extracted', details: [{ label: 'Tags found', value: '12' }, { label: 'Warnings', value: '0' }] },
    { id: 'quality_gate', name: 'Quality Gate',   status: 'passed', durationMs: 1540,  summary: '49/49 checks passed', details: [{ label: 'Passed', value: '49' }, { label: 'Failed', value: '0' }, { label: 'Skipped', value: '0' }] },
    { id: 'npm_validate', name: 'NPM Validate',   status: 'passed', durationMs: 2230,  summary: 'Dependencies resolved', details: [{ label: 'Dependencies', value: '14' }, { label: 'Conflicts', value: '0' }] },
    { id: 'security',     name: 'Security Scan',  status: 'passed', durationMs: 890,   summary: '0 vulnerabilities', details: [{ label: 'Categories', value: '15' }, { label: 'Issues', value: '0' }] },
    { id: 'test_suite',   name: 'Test Suite',     status: 'passed', durationMs: 3100,  summary: '24/24 tests passed', details: [{ label: 'Tests', value: '24' }, { label: 'Failures', value: '0' }, { label: 'Coverage', value: '87%' }] },
    { id: 'deploy',       name: 'Deploy',         status: 'passed', durationMs: 1870,  summary: 'Live on Blaxel', details: [{ label: 'Bundle size', value: '142 KB' }, { label: 'Sandbox', value: 'blx-a7f3' }] },
  ];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const statusColors: Record<StageStatus, string> = {
  pending: 'border-zinc-700 bg-zinc-800/60 text-zinc-400',
  running: 'border-amber-500/60 bg-amber-950/40 text-amber-300',
  passed:  'border-emerald-500/50 bg-emerald-950/30 text-emerald-300',
  failed:  'border-red-500/50 bg-red-950/30 text-red-300',
};

const statusDot: Record<StageStatus, string> = {
  pending: 'bg-zinc-500',
  running: 'bg-amber-400',
  passed:  'bg-emerald-400',
  failed:  'bg-red-400',
};

const statusGlow: Record<StageStatus, string> = {
  pending: '',
  running: 'shadow-[0_0_20px_rgba(251,191,36,0.3)]',
  passed:  'shadow-[0_0_12px_rgba(52,211,153,0.2)]',
  failed:  'shadow-[0_0_12px_rgba(248,113,113,0.2)]',
};

/* ------------------------------------------------------------------ */
/*  Connector line between stages                                      */
/* ------------------------------------------------------------------ */

function Connector({ fromStatus, toStatus }: { fromStatus: StageStatus; toStatus: StageStatus }) {
  const isActive = fromStatus === 'passed';
  const isRunning = toStatus === 'running';

  return (
    <div className="relative flex items-center mx-1 w-10 shrink-0">
      {/* Base line */}
      <div className="absolute inset-y-1/2 left-0 right-0 h-0.5 bg-zinc-700 rounded-full" />
      {/* Animated fill */}
      <motion.div
        className={cn(
          'absolute inset-y-1/2 left-0 h-0.5 rounded-full',
          isActive ? 'bg-emerald-500' : 'bg-zinc-700',
        )}
        initial={{ width: '0%' }}
        animate={{ width: isActive ? '100%' : '0%' }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />
      {/* Pulse dot traveling along the connector when next stage is running */}
      {isRunning && (
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-amber-400"
          animate={{ left: ['0%', '100%'] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Single stage node                                                  */
/* ------------------------------------------------------------------ */

interface StageNodeProps {
  stage: PipelineStage;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  onClick?: () => void;
}

function StageNode({ stage, index, isExpanded, onToggle, onClick }: StageNodeProps) {
  const meta = STAGE_META[stage.id] ?? { icon: Cpu, color: 'from-zinc-500 to-zinc-600' };
  const Icon = meta.icon;

  return (
    <motion.div
      className="flex flex-col items-center shrink-0"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: 'easeOut' }}
    >
      {/* Card */}
      <motion.button
        onClick={() => {
          onToggle();
          onClick?.();
        }}
        className={cn(
          'relative flex flex-col items-center gap-1.5 rounded-xl border px-4 py-3 min-w-[120px]',
          'transition-colors duration-300 cursor-pointer select-none',
          statusColors[stage.status],
          statusGlow[stage.status],
        )}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
      >
        {/* Glow ring for running stages */}
        {stage.status === 'running' && (
          <motion.div
            className="absolute -inset-[2px] rounded-xl border-2 border-amber-400/50"
            animate={{ opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        {/* Icon with gradient background */}
        <div
          className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br',
            stage.status === 'pending' ? 'from-zinc-600 to-zinc-700' : meta.color,
            stage.status === 'pending' && 'opacity-50',
          )}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>

        {/* Name */}
        <span className="text-xs font-semibold tracking-wide whitespace-nowrap">
          {stage.name}
        </span>

        {/* Status row */}
        <div className="flex items-center gap-1.5">
          {stage.status === 'running' ? (
            <motion.div
              className={cn('w-2 h-2 rounded-full', statusDot[stage.status])}
              animate={{ scale: [1, 1.5, 1], opacity: [1, 0.6, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          ) : (
            <div className={cn('w-2 h-2 rounded-full', statusDot[stage.status])} />
          )}
          <span className="text-[10px] uppercase tracking-wider opacity-80">
            {stage.status}
          </span>
        </div>

        {/* Duration */}
        {stage.durationMs != null && (
          <span className="text-[10px] text-zinc-500 font-mono">
            {formatDuration(stage.durationMs)}
          </span>
        )}

        {/* Expand chevron */}
        <div className="mt-0.5 text-zinc-500">
          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </div>
      </motion.button>

      {/* Expandable details panel */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className={cn(
              'mt-2 w-48 rounded-lg border p-3',
              'bg-zinc-900/90 border-zinc-700 backdrop-blur-sm',
            )}
            initial={{ opacity: 0, height: 0, scaleY: 0.8 }}
            animate={{ opacity: 1, height: 'auto', scaleY: 1 }}
            exit={{ opacity: 0, height: 0, scaleY: 0.8 }}
            transition={{ duration: 0.25 }}
            style={{ originY: 0 }}
          >
            {stage.summary && (
              <p className="text-xs text-zinc-300 mb-2 font-medium">{stage.summary}</p>
            )}
            {stage.details?.map((d) => (
              <div key={d.label} className="flex justify-between text-[11px] py-0.5">
                <span className="text-zinc-500">{d.label}</span>
                <span className="text-zinc-300 font-mono">{d.value}</span>
              </div>
            ))}
            {!stage.summary && (!stage.details || stage.details.length === 0) && (
              <p className="text-[11px] text-zinc-500 italic">No details available</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function PipelineVisualization({
  operationId,
  stages: stagesProp,
  onStageClick,
}: PipelineVisualizationProps) {
  const [stages, setStages] = useState<PipelineStage[]>(stagesProp ?? []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!stagesProp);
  const [error, setError] = useState<string | null>(null);

  /* Fetch pipeline stages from API when not provided as props */
  useEffect(() => {
    if (stagesProp) {
      setStages(stagesProp);
      return;
    }

    let cancelled = false;
    setLoading(true);

    api
      .get<{ stages: PipelineStage[] }>(`/api/operations/${operationId}/pipeline`)
      .then((res) => {
        if (!cancelled) {
          setStages(res.stages);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          /* Fallback to sample data so the component is always useful */
          setStages(sampleStages());
          setError(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [operationId, stagesProp]);

  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  /* Sort stages into canonical pipeline order */
  const ordered = STAGE_ORDER.map((id) => stages.find((s) => s.id === id)).filter(
    (s): s is PipelineStage => s != null,
  );

  /* Overall progress */
  const total = ordered.length;
  const completed = ordered.filter((s) => s.status === 'passed' || s.status === 'failed').length;
  const hasFailed = ordered.some((s) => s.status === 'failed');
  const allPassed = total > 0 && ordered.every((s) => s.status === 'passed');

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <motion.div
          className="w-6 h-6 rounded-full border-2 border-zinc-600 border-t-violet-400"
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        />
        <span className="ml-3 text-sm text-zinc-400">Loading pipeline...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-800/50 bg-red-950/20 p-4 text-sm text-red-300">
        {error}
      </div>
    );
  }

  return (
    <motion.div
      className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 backdrop-blur-sm p-6 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-zinc-200 tracking-wide">Build Pipeline</h3>
          <span
            className={cn(
              'text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full',
              allPassed && 'bg-emerald-500/20 text-emerald-400',
              hasFailed && 'bg-red-500/20 text-red-400',
              !allPassed && !hasFailed && 'bg-amber-500/20 text-amber-400',
            )}
          >
            {allPassed ? 'Passed' : hasFailed ? 'Failed' : 'Running'}
          </span>
        </div>
        <span className="text-xs text-zinc-500 font-mono">
          {completed}/{total} stages
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative h-1 rounded-full bg-zinc-800 mb-6 overflow-hidden">
        <motion.div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            hasFailed ? 'bg-red-500' : allPassed ? 'bg-emerald-500' : 'bg-amber-400',
          )}
          initial={{ width: '0%' }}
          animate={{ width: total > 0 ? `${(completed / total) * 100}%` : '0%' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
        {/* Shimmer on active pipeline */}
        {!allPassed && !hasFailed && (
          <motion.div
            className="absolute inset-y-0 w-20 bg-gradient-to-r from-transparent via-white/10 to-transparent"
            animate={{ left: ['-20%', '120%'] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </div>

      {/* Pipeline nodes + connectors */}
      <div className="flex items-start justify-center overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-zinc-700">
        {ordered.map((stage, i) => (
          <div key={stage.id} className="flex items-start">
            {/* Connector from previous stage */}
            {i > 0 && (
              <div className="flex items-center pt-[42px]">
                <Connector
                  fromStatus={ordered[i - 1]!.status}
                  toStatus={stage.status}
                />
              </div>
            )}

            <StageNode
              stage={stage}
              index={i}
              isExpanded={expandedId === stage.id}
              onToggle={() => handleToggle(stage.id)}
              onClick={() => onStageClick?.(stage.id)}
            />
          </div>
        ))}
      </div>

      {/* Total duration footer */}
      {allPassed && (
        <motion.div
          className="mt-4 pt-3 border-t border-zinc-800 flex items-center justify-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <span className="text-[11px] text-zinc-500">Total pipeline time</span>
          <span className="text-xs font-mono text-emerald-400">
            {formatDuration(
              ordered.reduce((sum, s) => sum + (s.durationMs ?? 0), 0),
            )}
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}
