/**
 * WorkflowAutomation — visual workflow designer for Argo.
 *
 * Users build automation workflows by adding steps, connecting them
 * vertically, configuring each step via a side panel, and running
 * test simulations to watch data flow through the pipeline.
 */

import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ArrowDown,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Database,
  FileText,
  Filter,
  Globe,
  Loader2,
  Mail,
  Pen,
  Play,
  Plus,
  Rocket,
  Save,
  Settings,
  Shuffle,
  Sparkles,
  Trash2,
  UserCheck,
  Webhook,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type StepKind =
  | 'trigger'
  | 'validate'
  | 'classify'
  | 'enrich'
  | 'filter'
  | 'transform'
  | 'email'
  | 'approval'
  | 'database'
  | 'webhook'
  | 'notify'
  | 'digest';

export type TriggerSource = 'form_submission' | 'email_received' | 'scheduled' | 'webhook';

export interface WorkflowStep {
  id: string;
  kind: StepKind;
  name: string;
  description: string;
  config: Record<string, unknown>;
  errorBehavior: 'stop' | 'skip' | 'retry';
  condition: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

interface WorkflowAutomationProps {
  operationId?: string;
  initialWorkflow?: WorkflowDefinition;
  onSave?: (workflow: WorkflowDefinition) => void;
  onDeploy?: (workflow: WorkflowDefinition) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STEP_META: Record<StepKind, { label: string; icon: typeof Zap; color: string; desc: string }> = {
  trigger:   { label: 'Trigger',   icon: Zap,           color: 'text-amber-400',   desc: 'Event that starts the workflow' },
  validate:  { label: 'Validate',  icon: CheckCircle2,  color: 'text-emerald-400', desc: 'Run Zod schema validation on input' },
  classify:  { label: 'Classify',  icon: Bot,           color: 'text-violet-400',  desc: 'AI classifies input by intent' },
  enrich:    { label: 'Enrich',    icon: Sparkles,      color: 'text-cyan-400',    desc: 'Pull additional data from sources' },
  filter:    { label: 'Filter',    icon: Filter,        color: 'text-orange-400',  desc: 'Conditional routing on field values' },
  transform: { label: 'Transform', icon: Shuffle,       color: 'text-pink-400',    desc: 'Reshape data between steps' },
  email:     { label: 'Email',     icon: Mail,          color: 'text-sky-400',     desc: 'Send a templated email' },
  approval:  { label: 'Approval',  icon: UserCheck,     color: 'text-yellow-400',  desc: 'Human-in-the-loop approval gate' },
  database:  { label: 'Database',  icon: Database,      color: 'text-indigo-400',  desc: 'Store or query records' },
  webhook:   { label: 'Webhook',   icon: Webhook,       color: 'text-rose-400',    desc: 'Call an external API' },
  notify:    { label: 'Notify',    icon: Bell,          color: 'text-teal-400',    desc: 'Send a Slack / notification' },
  digest:    { label: 'Digest',    icon: ClipboardList, color: 'text-lime-400',    desc: 'Compile periodic summary' },
};

const TRIGGER_SOURCES: { value: TriggerSource; label: string }[] = [
  { value: 'form_submission', label: 'Form Submission' },
  { value: 'email_received',  label: 'Email Received' },
  { value: 'scheduled',       label: 'Scheduled (Cron)' },
  { value: 'webhook',         label: 'Incoming Webhook' },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function makeStep(kind: StepKind): WorkflowStep {
  return {
    id: uid(),
    kind,
    name: STEP_META[kind].label,
    description: '',
    config: kind === 'trigger' ? { source: 'form_submission' as TriggerSource } : {},
    errorBehavior: 'stop',
    condition: '',
  };
}

function emptyWorkflow(): WorkflowDefinition {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name: 'Untitled Workflow',
    description: '',
    steps: [makeStep('trigger')],
    createdAt: now,
    updatedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/*  Simulation helpers                                                 */
/* ------------------------------------------------------------------ */

type SimStatus = 'idle' | 'running' | 'done';

interface SimState {
  status: SimStatus;
  activeIdx: number;
  results: Record<string, 'pass' | 'fail' | 'skipped'>;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function WorkflowAutomation({ operationId, initialWorkflow, onSave, onDeploy }: WorkflowAutomationProps) {
  const [workflow, setWorkflow] = useState<WorkflowDefinition>(initialWorkflow ?? emptyWorkflow());
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [sim, setSim] = useState<SimState>({ status: 'idle', activeIdx: -1, results: {} });
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);

  const selectedStep = useMemo(
    () => workflow.steps.find((s) => s.id === selectedStepId) ?? null,
    [workflow.steps, selectedStepId],
  );

  /* ---- Mutations ---- */

  const updateWorkflow = useCallback((patch: Partial<WorkflowDefinition>) => {
    setWorkflow((prev) => ({ ...prev, ...patch, updatedAt: new Date().toISOString() }));
  }, []);

  const addStep = useCallback(
    (kind: StepKind) => {
      const step = makeStep(kind);
      updateWorkflow({ steps: [...workflow.steps, step] });
      setSelectedStepId(step.id);
      setShowAddMenu(false);
    },
    [workflow.steps, updateWorkflow],
  );

  const removeStep = useCallback(
    (id: string) => {
      updateWorkflow({ steps: workflow.steps.filter((s) => s.id !== id) });
      if (selectedStepId === id) setSelectedStepId(null);
    },
    [workflow.steps, selectedStepId, updateWorkflow],
  );

  const updateStep = useCallback(
    (id: string, patch: Partial<WorkflowStep>) => {
      updateWorkflow({
        steps: workflow.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      });
    },
    [workflow.steps, updateWorkflow],
  );

  const moveStep = useCallback(
    (idx: number, dir: -1 | 1) => {
      const next = idx + dir;
      if (next < 1 || next >= workflow.steps.length) return; // can't move trigger
      const copy = [...workflow.steps];
      const a = copy[idx]!;
      const b = copy[next]!;
      copy[idx] = b;
      copy[next] = a;
      updateWorkflow({ steps: copy });
    },
    [workflow.steps, updateWorkflow],
  );

  /* ---- Save / Deploy ---- */

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave?.(workflow);
    } finally {
      setTimeout(() => setSaving(false), 600);
    }
  }, [workflow, onSave]);

  const handleDeploy = useCallback(async () => {
    setDeploying(true);
    try {
      await onDeploy?.(workflow);
    } finally {
      setTimeout(() => setDeploying(false), 1200);
    }
  }, [workflow, onDeploy]);

  /* ---- Test Simulation ---- */

  const runSimulation = useCallback(async () => {
    if (sim.status === 'running') return;
    setSim({ status: 'running', activeIdx: 0, results: {} });

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i]!;
      setSim((prev) => ({ ...prev, activeIdx: i }));
      // Simulate processing time per step
      await new Promise((r) => setTimeout(r, 700 + Math.random() * 500));
      const outcome: 'pass' | 'fail' | 'skipped' =
        step.condition && Math.random() < 0.15 ? 'skipped' : Math.random() < 0.1 ? 'fail' : 'pass';
      setSim((prev) => ({
        ...prev,
        results: { ...prev.results, [step.id]: outcome },
      }));
      if (outcome === 'fail' && step.errorBehavior === 'stop') break;
    }

    setSim((prev) => ({ ...prev, status: 'done', activeIdx: -1 }));
  }, [workflow.steps, sim.status]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex h-full w-full bg-argo-900 text-white overflow-hidden">
      {/* ---- Main canvas area ---- */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top bar */}
        <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3 shrink-0">
          <div className="flex-1 min-w-0">
            <input
              className="bg-transparent text-lg font-semibold w-full outline-none placeholder:text-white/30 truncate"
              value={workflow.name}
              placeholder="Workflow name"
              onChange={(e) => updateWorkflow({ name: e.target.value })}
            />
            <input
              className="bg-transparent text-xs text-white/50 w-full outline-none placeholder:text-white/20 mt-0.5"
              value={workflow.description}
              placeholder="Add a description..."
              onChange={(e) => updateWorkflow({ description: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={runSimulation}
              disabled={sim.status === 'running'}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
                sim.status === 'running'
                  ? 'bg-amber-500/20 text-amber-300 cursor-wait'
                  : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
              )}
            >
              {sim.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run Test
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 transition"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Draft
            </button>
            <button
              onClick={handleDeploy}
              disabled={deploying}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
                deploying
                  ? 'bg-emerald-500/20 text-emerald-300 cursor-wait'
                  : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
              )}
            >
              {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              Deploy
            </button>
          </div>
        </header>

        {/* Canvas */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-md flex flex-col items-center">
            <AnimatePresence initial={false}>
              {workflow.steps.map((step, idx) => {
                const meta = STEP_META[step.kind];
                const Icon = meta.icon;
                const isActive = sim.status === 'running' && sim.activeIdx === idx;
                const result = sim.results[step.id];
                const isSelected = selectedStepId === step.id;

                return (
                  <div key={step.id} className="flex flex-col items-center w-full">
                    {/* Connection line from previous step */}
                    {idx > 0 && (
                      <svg width="2" height="36" className="shrink-0 overflow-visible">
                        <motion.line
                          x1="1" y1="0" x2="1" y2="36"
                          stroke={isActive ? '#f59e0b' : result === 'pass' ? '#34d399' : result === 'fail' ? '#f87171' : 'rgba(255,255,255,0.15)'}
                          strokeWidth="2"
                          strokeDasharray={isActive ? '4 4' : 'none'}
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.3 }}
                        />
                        {isActive && (
                          <motion.circle
                            cx="1" r="3"
                            fill="#f59e0b"
                            initial={{ cy: 0 }}
                            animate={{ cy: [0, 36] }}
                            transition={{ duration: 0.6, repeat: Infinity, ease: 'linear' }}
                          />
                        )}
                      </svg>
                    )}

                    {/* Step card */}
                    <motion.button
                      layout
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      onClick={() => setSelectedStepId(isSelected ? null : step.id)}
                      className={cn(
                        'relative w-full rounded-xl border px-4 py-3 text-left transition-all',
                        isSelected
                          ? 'border-indigo-500/60 bg-indigo-500/10 shadow-lg shadow-indigo-500/10'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]',
                        isActive && 'ring-2 ring-amber-400/50',
                        result === 'pass' && 'border-emerald-500/30',
                        result === 'fail' && 'border-red-500/30',
                        result === 'skipped' && 'border-white/5 opacity-50',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn('rounded-lg bg-white/5 p-2', meta.color)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{step.name}</div>
                          <div className="text-[11px] text-white/40 truncate">
                            {step.description || meta.desc}
                          </div>
                        </div>

                        {/* Simulation result badge */}
                        {result === 'pass' && <Check className="h-4 w-4 text-emerald-400 shrink-0" />}
                        {result === 'fail' && <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />}
                        {result === 'skipped' && <span className="text-[10px] text-white/30 shrink-0">skipped</span>}
                        {isActive && <Loader2 className="h-4 w-4 text-amber-400 animate-spin shrink-0" />}

                        {/* Delete (not for trigger) */}
                        {step.kind !== 'trigger' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeStep(step.id);
                            }}
                            className="rounded p-1 text-white/20 hover:text-red-400 hover:bg-red-500/10 transition opacity-0 group-hover:opacity-100"
                            style={{ opacity: isSelected ? 1 : undefined }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Condition badge */}
                      {step.condition && (
                        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-orange-300/70">
                          <Filter className="h-3 w-3" />
                          <span className="truncate">if: {step.condition}</span>
                        </div>
                      )}
                    </motion.button>
                  </div>
                );
              })}
            </AnimatePresence>

            {/* Add step button */}
            <svg width="2" height="28" className="shrink-0">
              <line x1="1" y1="0" x2="1" y2="28" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
            </svg>

            <div className="relative">
              <button
                onClick={() => setShowAddMenu((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-4 py-2 text-xs text-white/40 hover:border-white/30 hover:text-white/60 transition"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Step
                <ChevronDown className={cn('h-3 w-3 transition-transform', showAddMenu && 'rotate-180')} />
              </button>

              <AnimatePresence>
                {showAddMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    className="absolute left-1/2 -translate-x-1/2 mt-2 z-30 w-64 rounded-xl border border-white/10 bg-argo-800 p-2 shadow-2xl"
                  >
                    <div className="grid grid-cols-2 gap-1">
                      {(Object.entries(STEP_META) as [StepKind, (typeof STEP_META)[StepKind]][])
                        .filter(([kind]) => kind !== 'trigger')
                        .map(([kind, meta]) => {
                          const Icon = meta.icon;
                          return (
                            <button
                              key={kind}
                              onClick={() => addStep(kind)}
                              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/5 transition"
                            >
                              <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.color)} />
                              <span className="text-xs text-white/70">{meta.label}</span>
                            </button>
                          );
                        })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Simulation summary */}
            <AnimatePresence>
              {sim.status === 'done' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-6 w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 text-center"
                >
                  <div className="text-sm font-medium mb-1">Test Run Complete</div>
                  <div className="flex items-center justify-center gap-4 text-xs text-white/50">
                    <span className="flex items-center gap-1 text-emerald-400">
                      <Check className="h-3 w-3" />
                      {Object.values(sim.results).filter((r) => r === 'pass').length} passed
                    </span>
                    <span className="flex items-center gap-1 text-red-400">
                      <AlertTriangle className="h-3 w-3" />
                      {Object.values(sim.results).filter((r) => r === 'fail').length} failed
                    </span>
                    <span className="text-white/30">
                      {Object.values(sim.results).filter((r) => r === 'skipped').length} skipped
                    </span>
                  </div>
                  <button
                    onClick={() => setSim({ status: 'idle', activeIdx: -1, results: {} })}
                    className="mt-3 text-[11px] text-white/30 hover:text-white/50 transition"
                  >
                    Clear results
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ---- Configuration side panel ---- */}
      <AnimatePresence>
        {selectedStep && (
          <motion.aside
            key="config-panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 340, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="shrink-0 border-l border-white/10 bg-argo-850 overflow-hidden"
          >
            <div className="h-full overflow-y-auto p-5 w-[340px]">
              {/* Panel header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-white/40" />
                  <span className="text-sm font-semibold">Configure Step</span>
                </div>
                <button
                  onClick={() => setSelectedStepId(null)}
                  className="rounded p-1 text-white/30 hover:text-white/60 hover:bg-white/5 transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Step type badge */}
              <div className="flex items-center gap-2 mb-5">
                {(() => {
                  const meta = STEP_META[selectedStep.kind];
                  const Icon = meta.icon;
                  return (
                    <>
                      <div className={cn('rounded-lg bg-white/5 p-2', meta.color)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-xs font-medium">{meta.label}</div>
                        <div className="text-[10px] text-white/40">{meta.desc}</div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Fields */}
              <div className="space-y-4">
                {/* Name */}
                <label className="block">
                  <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Name</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 transition"
                    value={selectedStep.name}
                    onChange={(e) => updateStep(selectedStep.id, { name: e.target.value })}
                  />
                </label>

                {/* Description */}
                <label className="block">
                  <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Description</span>
                  <textarea
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none resize-none focus:border-indigo-500/50 transition"
                    value={selectedStep.description}
                    placeholder="What does this step do?"
                    onChange={(e) => updateStep(selectedStep.id, { description: e.target.value })}
                  />
                </label>

                {/* Trigger source */}
                {selectedStep.kind === 'trigger' && (
                  <label className="block">
                    <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Trigger Source</span>
                    <select
                      className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 transition"
                      value={(selectedStep.config.source as string) ?? 'form_submission'}
                      onChange={(e) =>
                        updateStep(selectedStep.id, {
                          config: { ...selectedStep.config, source: e.target.value },
                        })
                      }
                    >
                      {TRIGGER_SOURCES.map((ts) => (
                        <option key={ts.value} value={ts.value}>
                          {ts.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {/* Email template */}
                {selectedStep.kind === 'email' && (
                  <>
                    <label className="block">
                      <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Recipient</span>
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 transition"
                        placeholder="{{input.email}}"
                        value={(selectedStep.config.recipient as string) ?? ''}
                        onChange={(e) =>
                          updateStep(selectedStep.id, { config: { ...selectedStep.config, recipient: e.target.value } })
                        }
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Subject</span>
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 transition"
                        placeholder="Your request has been received"
                        value={(selectedStep.config.subject as string) ?? ''}
                        onChange={(e) =>
                          updateStep(selectedStep.id, { config: { ...selectedStep.config, subject: e.target.value } })
                        }
                      />
                    </label>
                  </>
                )}

                {/* Webhook URL */}
                {selectedStep.kind === 'webhook' && (
                  <label className="block">
                    <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Endpoint URL</span>
                    <input
                      className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 transition"
                      placeholder="https://api.example.com/hook"
                      value={(selectedStep.config.url as string) ?? ''}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { config: { ...selectedStep.config, url: e.target.value } })
                      }
                    />
                  </label>
                )}

                {/* Validate schema */}
                {selectedStep.kind === 'validate' && (
                  <label className="block">
                    <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Zod Schema</span>
                    <textarea
                      rows={4}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono outline-none resize-none focus:border-indigo-500/50 transition"
                      placeholder={'z.object({\n  email: z.string().email(),\n  name: z.string().min(1),\n})'}
                      value={(selectedStep.config.schema as string) ?? ''}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { config: { ...selectedStep.config, schema: e.target.value } })
                      }
                    />
                  </label>
                )}

                {/* Classify prompt */}
                {selectedStep.kind === 'classify' && (
                  <label className="block">
                    <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Classification Prompt</span>
                    <textarea
                      rows={3}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none resize-none focus:border-indigo-500/50 transition"
                      placeholder="Classify the intent: support, sales, billing, other"
                      value={(selectedStep.config.prompt as string) ?? ''}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { config: { ...selectedStep.config, prompt: e.target.value } })
                      }
                    />
                  </label>
                )}

                {/* Filter condition expression */}
                {selectedStep.kind === 'filter' && (
                  <label className="block">
                    <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Filter Expression</span>
                    <input
                      className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono outline-none focus:border-indigo-500/50 transition"
                      placeholder='input.category === "support"'
                      value={(selectedStep.config.expression as string) ?? ''}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { config: { ...selectedStep.config, expression: e.target.value } })
                      }
                    />
                  </label>
                )}

                {/* Transform mapping */}
                {selectedStep.kind === 'transform' && (
                  <label className="block">
                    <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Mapping (JSON)</span>
                    <textarea
                      rows={4}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono outline-none resize-none focus:border-indigo-500/50 transition"
                      placeholder={'{\n  "fullName": "{{first}} {{last}}",\n  "ts": "{{now}}"\n}'}
                      value={(selectedStep.config.mapping as string) ?? ''}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { config: { ...selectedStep.config, mapping: e.target.value } })
                      }
                    />
                  </label>
                )}

                {/* Approval reviewer */}
                {selectedStep.kind === 'approval' && (
                  <label className="block">
                    <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Reviewer Email</span>
                    <input
                      className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 transition"
                      placeholder="manager@company.com"
                      value={(selectedStep.config.reviewer as string) ?? ''}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { config: { ...selectedStep.config, reviewer: e.target.value } })
                      }
                    />
                  </label>
                )}

                {/* Database table */}
                {selectedStep.kind === 'database' && (
                  <>
                    <label className="block">
                      <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Operation</span>
                      <select
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 transition"
                        value={(selectedStep.config.operation as string) ?? 'insert'}
                        onChange={(e) =>
                          updateStep(selectedStep.id, { config: { ...selectedStep.config, operation: e.target.value } })
                        }
                      >
                        <option value="insert">Insert</option>
                        <option value="update">Update</option>
                        <option value="query">Query</option>
                        <option value="delete">Delete</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Table</span>
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 transition"
                        placeholder="submissions"
                        value={(selectedStep.config.table as string) ?? ''}
                        onChange={(e) =>
                          updateStep(selectedStep.id, { config: { ...selectedStep.config, table: e.target.value } })
                        }
                      />
                    </label>
                  </>
                )}

                {/* Notify channel */}
                {selectedStep.kind === 'notify' && (
                  <>
                    <label className="block">
                      <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Channel</span>
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 transition"
                        placeholder="#general"
                        value={(selectedStep.config.channel as string) ?? ''}
                        onChange={(e) =>
                          updateStep(selectedStep.id, { config: { ...selectedStep.config, channel: e.target.value } })
                        }
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Message</span>
                      <textarea
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none resize-none focus:border-indigo-500/50 transition"
                        placeholder="New submission from {{input.name}}"
                        value={(selectedStep.config.message as string) ?? ''}
                        onChange={(e) =>
                          updateStep(selectedStep.id, { config: { ...selectedStep.config, message: e.target.value } })
                        }
                      />
                    </label>
                  </>
                )}

                {/* Digest schedule */}
                {selectedStep.kind === 'digest' && (
                  <label className="block">
                    <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Schedule</span>
                    <select
                      className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 transition"
                      value={(selectedStep.config.schedule as string) ?? 'daily'}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { config: { ...selectedStep.config, schedule: e.target.value } })
                      }
                    >
                      <option value="hourly">Hourly</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                    </select>
                  </label>
                )}

                {/* Enrich source */}
                {selectedStep.kind === 'enrich' && (
                  <label className="block">
                    <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Data Source URL</span>
                    <input
                      className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 transition"
                      placeholder="https://api.clearbit.com/v2/people/find"
                      value={(selectedStep.config.sourceUrl as string) ?? ''}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { config: { ...selectedStep.config, sourceUrl: e.target.value } })
                      }
                    />
                  </label>
                )}

                <hr className="border-white/5" />

                {/* Condition */}
                <label className="block">
                  <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">Execution Condition</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono outline-none focus:border-indigo-500/50 transition"
                    placeholder='e.g. input.score > 50'
                    value={selectedStep.condition}
                    onChange={(e) => updateStep(selectedStep.id, { condition: e.target.value })}
                  />
                  <span className="text-[10px] text-white/30 mt-1 block">
                    Leave empty to always execute. Uses JS expression syntax.
                  </span>
                </label>

                {/* Error handling */}
                <label className="block">
                  <span className="text-[11px] text-white/50 uppercase tracking-wider font-medium">On Error</span>
                  <select
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-indigo-500/50 transition"
                    value={selectedStep.errorBehavior}
                    onChange={(e) =>
                      updateStep(selectedStep.id, {
                        errorBehavior: e.target.value as WorkflowStep['errorBehavior'],
                      })
                    }
                  >
                    <option value="stop">Stop workflow</option>
                    <option value="skip">Skip and continue</option>
                    <option value="retry">Retry (3 attempts)</option>
                  </select>
                </label>

                {/* Reorder / Delete */}
                {selectedStep.kind !== 'trigger' && (
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={() => {
                        const idx = workflow.steps.findIndex((s) => s.id === selectedStep.id);
                        moveStep(idx, -1);
                      }}
                      className="flex-1 rounded-lg border border-white/10 py-1.5 text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition"
                    >
                      Move Up
                    </button>
                    <button
                      onClick={() => {
                        const idx = workflow.steps.findIndex((s) => s.id === selectedStep.id);
                        moveStep(idx, 1);
                      }}
                      className="flex-1 rounded-lg border border-white/10 py-1.5 text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition"
                    >
                      Move Down
                    </button>
                    <button
                      onClick={() => removeStep(selectedStep.id)}
                      className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
