/**
 * AgentBuilder — the component that makes Argo an agent PLATFORM, not just
 * another vibe-coding app builder. Users visually compose custom AI agents:
 * pick a model, wire up tools, set triggers, test in a sandbox, and deploy
 * to production with one click.
 *
 * No other tool does this. Replit/Lovable build apps. Argo builds agents
 * that run your business while you sleep.
 */

import { useCallback, useMemo, useReducer, useRef, useState } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import {
  Bell,
  Bot,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Cpu,
  Database,
  FileText,
  Globe,
  GripVertical,
  Loader2,
  Mail,
  MessageSquare,
  Play,
  Plus,
  Rocket,
  Shield,
  Sparkles,
  Trash2,
  Users,
  Webhook,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils.js';

// ── Types ─────────────────────────────────────────────────────────────────

interface ModelOption {
  id: string;
  label: string;
  provider: string;
  description: string;
}

interface ToolDef {
  id: string;
  name: string;
  icon: LucideIcon;
  category: string;
  capabilities: string[];
}

interface AgentTemplate {
  id: string;
  name: string;
  tagline: string;
  icon: LucideIcon;
  tools: string[];
  model: string;
  systemPrompt: string;
  triggerType: TriggerType;
}

type TriggerType = 'form' | 'email' | 'cron' | 'webhook' | 'manual';

interface AgentConfig {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  enabledTools: string[];
  triggerType: TriggerType;
  cronExpression: string;
}

type AgentAction =
  | { type: 'SET_FIELD'; field: keyof AgentConfig; value: string | number }
  | { type: 'TOGGLE_TOOL'; toolId: string }
  | { type: 'SET_TOOLS'; toolIds: string[] }
  | { type: 'LOAD_TEMPLATE'; config: Partial<AgentConfig> }
  | { type: 'RESET' };

type BuilderTab = 'configure' | 'tools' | 'triggers' | 'test' | 'gallery';

// ── Constants ─────────────────────────────────────────────────────────────

const MODELS: ModelOption[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'OpenAI', description: 'Best for creative generation and complex reasoning chains' },
  { id: 'claude-opus', label: 'Claude Opus', provider: 'Anthropic', description: 'Deepest analysis, longest context, highest accuracy' },
  { id: 'claude-sonnet', label: 'Claude Sonnet', provider: 'Anthropic', description: 'Best balance of speed and intelligence for most agents' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI', description: 'Fast multimodal model, great for real-time interactions' },
];

const TOOLS: ToolDef[] = [
  { id: 'email', name: 'Email', icon: Mail, category: 'Communication', capabilities: ['Send', 'Read', 'Classify'] },
  { id: 'database', name: 'Database', icon: Database, category: 'Data', capabilities: ['Query', 'Insert', 'Update'] },
  { id: 'web', name: 'Web', icon: Globe, category: 'Integration', capabilities: ['Fetch URL', 'Scrape', 'API Call'] },
  { id: 'file', name: 'File', icon: FileText, category: 'Data', capabilities: ['Read', 'Write', 'Parse CSV/PDF'] },
  { id: 'calendar', name: 'Calendar', icon: Calendar, category: 'Productivity', capabilities: ['Create Event', 'Check Availability'] },
  { id: 'notification', name: 'Notification', icon: Bell, category: 'Communication', capabilities: ['Slack', 'Webhook', 'SMS'] },
  { id: 'human-in-loop', name: 'Human-in-the-Loop', icon: Shield, category: 'Safety', capabilities: ['Approval Gate', 'Escalation'] },
];

const TRIGGER_OPTIONS: { type: TriggerType; label: string; description: string; icon: LucideIcon }[] = [
  { type: 'form', label: 'Form Submission', description: 'Trigger when a user submits a form', icon: MessageSquare },
  { type: 'email', label: 'Email Received', description: 'Trigger when an email arrives', icon: Mail },
  { type: 'cron', label: 'Schedule / Cron', description: 'Run on a recurring schedule', icon: Clock },
  { type: 'webhook', label: 'Webhook', description: 'Trigger via HTTP POST request', icon: Webhook },
  { type: 'manual', label: 'Manual', description: 'Run on-demand from the dashboard', icon: Play },
];

const TEMPLATES: AgentTemplate[] = [
  {
    id: 'email-classifier', name: 'Email Classifier', tagline: 'Sorts incoming emails by intent',
    icon: Mail, tools: ['email', 'database', 'notification'], model: 'claude-sonnet',
    systemPrompt: 'You are an email classification agent. Analyze each incoming email, determine its intent (inquiry, complaint, order, spam), and route it to the appropriate team.',
    triggerType: 'email',
  },
  {
    id: 'lead-qualifier', name: 'Lead Qualifier', tagline: 'Scores and routes inbound leads',
    icon: Users, tools: ['email', 'database', 'web', 'notification'], model: 'gpt-5.5',
    systemPrompt: 'You are a lead qualification agent. Score each inbound lead on a 1-100 scale based on company size, role, engagement signals, and ICP fit. Route hot leads (80+) immediately to the sales team.',
    triggerType: 'webhook',
  },
  {
    id: 'support-triage', name: 'Customer Support Triage', tagline: 'Categorizes and responds to support tickets',
    icon: Bot, tools: ['email', 'database', 'web', 'human-in-loop'], model: 'claude-sonnet',
    systemPrompt: 'You are a customer support triage agent. Categorize tickets by severity (P0-P3) and topic. Auto-respond to common questions using the knowledge base. Escalate P0/P1 issues to a human.',
    triggerType: 'email',
  },
  {
    id: 'candidate-screener', name: 'Candidate Screener', tagline: 'Screens job applications',
    icon: Users, tools: ['email', 'file', 'database', 'notification'], model: 'claude-opus',
    systemPrompt: 'You are a candidate screening agent. Parse resumes, extract key qualifications, compare against job requirements, and produce a structured scorecard. Flag exceptional candidates for immediate review.',
    triggerType: 'form',
  },
  {
    id: 'invoice-processor', name: 'Invoice Processor', tagline: 'Extracts data from invoices',
    icon: FileText, tools: ['file', 'database', 'notification', 'human-in-loop'], model: 'gpt-4o',
    systemPrompt: 'You are an invoice processing agent. Extract vendor, line items, amounts, tax, and due dates from invoice PDFs. Validate against PO numbers in the database. Flag discrepancies for human review.',
    triggerType: 'webhook',
  },
  {
    id: 'meeting-scheduler', name: 'Meeting Scheduler', tagline: 'Handles scheduling via email',
    icon: Calendar, tools: ['email', 'calendar', 'notification'], model: 'claude-sonnet',
    systemPrompt: 'You are a scheduling assistant. Parse meeting requests from emails, check participant availability, propose optimal time slots, and send calendar invitations once confirmed.',
    triggerType: 'email',
  },
];

const INITIAL_CONFIG: AgentConfig = {
  name: '',
  description: '',
  model: 'claude-sonnet',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 4096,
  enabledTools: [],
  triggerType: 'manual',
  cronExpression: '0 9 * * 1-5',
};

// ── Reducer ───────────────────────────────────────────────────────────────

function agentReducer(state: AgentConfig, action: AgentAction): AgentConfig {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'TOGGLE_TOOL': {
      const tools = state.enabledTools.includes(action.toolId)
        ? state.enabledTools.filter((t) => t !== action.toolId)
        : [...state.enabledTools, action.toolId];
      return { ...state, enabledTools: tools };
    }
    case 'SET_TOOLS':
      return { ...state, enabledTools: action.toolIds };
    case 'LOAD_TEMPLATE':
      return { ...state, ...action.config };
    case 'RESET':
      return { ...INITIAL_CONFIG };
    default:
      return state;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function generateWebhookUrl(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-agent';
  return `https://api.argo.run/webhooks/${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

const fadeUp = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } };

// ── Component ─────────────────────────────────────────────────────────────

export function AgentBuilder({ operationId }: { operationId?: string }) {
  const [config, dispatch] = useReducer(agentReducer, INITIAL_CONFIG);
  const [activeTab, setActiveTab] = useState<BuilderTab>('configure');
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState(false);

  // Test playground state
  const [testInput, setTestInput] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<{ reasoning: string; actions: string[]; response: string } | null>(null);

  const [modelOpen, setModelOpen] = useState(false);
  const modelRef = useRef<HTMLDivElement>(null);

  const selectedModel = useMemo(() => MODELS.find((m) => m.id === config.model) ?? MODELS[2]!, [config.model]);
  const webhookUrl = useMemo(() => generateWebhookUrl(config.name), [config.name]);

  const isValid = config.name.trim().length > 0 && config.systemPrompt.trim().length > 0 && config.enabledTools.length > 0;

  const handleDeploy = useCallback(async () => {
    if (!isValid) return;
    setDeploying(true);
    // Simulate deploy — in production this calls the deploy API
    await new Promise((r) => setTimeout(r, 2200));
    setDeploying(false);
    setDeployed(true);
    setTimeout(() => setDeployed(false), 4000);
  }, [isValid]);

  const handleTest = useCallback(async () => {
    if (!testInput.trim()) return;
    setTestRunning(true);
    setTestResult(null);
    // Simulate agent run — in production this calls the agent runtime
    await new Promise((r) => setTimeout(r, 1800));
    setTestRunning(false);
    setTestResult({
      reasoning: `Analyzing input: "${testInput.slice(0, 60)}..."\n\n1. Identified intent and extracted key entities\n2. Selected tools: ${config.enabledTools.join(', ')}\n3. Executed tool chain and validated output`,
      actions: config.enabledTools.map((t) => `${TOOLS.find((x) => x.id === t)?.name ?? t}: executed successfully`),
      response: `Based on my analysis, I've processed your request using ${config.enabledTools.length} tool(s). The ${config.name || 'agent'} has completed the workflow successfully.`,
    });
  }, [testInput, config.enabledTools, config.name]);

  const loadTemplate = useCallback((tpl: AgentTemplate) => {
    dispatch({
      type: 'LOAD_TEMPLATE',
      config: {
        name: tpl.name,
        description: tpl.tagline,
        model: tpl.model,
        systemPrompt: tpl.systemPrompt,
        enabledTools: tpl.tools,
        triggerType: tpl.triggerType,
      },
    });
    setActiveTab('configure');
  }, []);

  // ── Tab definitions ───────────────────────────────────────────────────

  const TABS: { key: BuilderTab; label: string; icon: LucideIcon }[] = [
    { key: 'configure', label: 'Configure', icon: Cpu },
    { key: 'tools', label: 'Tools', icon: Wrench },
    { key: 'triggers', label: 'Triggers', icon: Zap },
    { key: 'test', label: 'Test', icon: Play },
    { key: 'gallery', label: 'Templates', icon: Sparkles },
  ];

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-argo-950 text-white">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/10 px-6 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-semibold tracking-tight">Agent Builder</h1>
          <p className="text-xs text-white/50">Create custom AI agents that automate your workflows</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          disabled={!isValid || deploying}
          onClick={handleDeploy}
          className={cn(
            'flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-all',
            isValid && !deploying
              ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40'
              : 'cursor-not-allowed bg-white/5 text-white/30',
          )}
        >
          {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : deployed ? <Check className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
          {deploying ? 'Deploying...' : deployed ? 'Deployed!' : 'Deploy Agent'}
        </motion.button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-white/10 px-6">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors',
                active ? 'text-white' : 'text-white/40 hover:text-white/70',
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {tab.key === 'tools' && config.enabledTools.length > 0 && (
                <span className="ml-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-violet-500/30 px-1.5 text-[10px] font-bold text-violet-300">
                  {config.enabledTools.length}
                </span>
              )}
              {active && (
                <motion.div layoutId="agent-tab-indicator" className="absolute inset-x-0 -bottom-px h-0.5 bg-gradient-to-r from-violet-500 to-fuchsia-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {/* ─── Configure Tab ────────────────────────────────────────── */}
          {activeTab === 'configure' && (
            <motion.div key="configure" {...fadeUp} className="mx-auto max-w-2xl space-y-6 p-6">
              {/* Name + Description */}
              <fieldset className="space-y-3">
                <label className="block text-sm font-medium text-white/70">Agent Name</label>
                <input
                  type="text"
                  value={config.name}
                  onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value })}
                  placeholder="e.g. Lead Qualifier"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                />
              </fieldset>

              <fieldset className="space-y-3">
                <label className="block text-sm font-medium text-white/70">Description</label>
                <input
                  type="text"
                  value={config.description}
                  onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'description', value: e.target.value })}
                  placeholder="What does this agent do?"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                />
              </fieldset>

              {/* Model selector */}
              <fieldset className="space-y-3">
                <label className="block text-sm font-medium text-white/70">Model</label>
                <div ref={modelRef} className="relative">
                  <button
                    onClick={() => setModelOpen(!modelOpen)}
                    className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white transition hover:border-white/20"
                  >
                    <span className="flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-violet-400" />
                      <span className="font-medium">{selectedModel.label}</span>
                      <span className="text-white/40">({selectedModel.provider})</span>
                    </span>
                    <ChevronDown className={cn('h-4 w-4 text-white/40 transition-transform', modelOpen && 'rotate-180')} />
                  </button>

                  <AnimatePresence>
                    {modelOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute z-20 mt-1 w-full rounded-lg border border-white/10 bg-argo-900 p-1 shadow-2xl"
                      >
                        {MODELS.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              dispatch({ type: 'SET_FIELD', field: 'model', value: m.id });
                              setModelOpen(false);
                            }}
                            className={cn(
                              'flex w-full flex-col items-start rounded-md px-3 py-2.5 text-left transition-colors hover:bg-white/5',
                              config.model === m.id && 'bg-violet-500/10',
                            )}
                          >
                            <span className="flex items-center gap-2 text-sm font-medium text-white">
                              {m.label}
                              <span className="text-xs text-white/40">{m.provider}</span>
                              {config.model === m.id && <Check className="h-3.5 w-3.5 text-violet-400" />}
                            </span>
                            <span className="mt-0.5 text-xs text-white/40">{m.description}</span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </fieldset>

              {/* System prompt */}
              <fieldset className="space-y-3">
                <label className="block text-sm font-medium text-white/70">System Prompt</label>
                <textarea
                  value={config.systemPrompt}
                  onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'systemPrompt', value: e.target.value })}
                  placeholder="You are an AI agent that..."
                  rows={6}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-white placeholder:text-white/25 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                />
                <p className="text-xs text-white/30">{config.systemPrompt.length} characters — be specific about the agent's role, constraints, and output format.</p>
              </fieldset>

              {/* Temperature + Max Tokens */}
              <div className="grid grid-cols-2 gap-6">
                <fieldset className="space-y-3">
                  <label className="flex items-center justify-between text-sm font-medium text-white/70">
                    Temperature
                    <span className="rounded bg-white/5 px-2 py-0.5 font-mono text-xs text-violet-300">{config.temperature.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={config.temperature}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'temperature', value: parseFloat(e.target.value) })}
                    className="w-full accent-violet-500"
                  />
                  <div className="flex justify-between text-[10px] text-white/30">
                    <span>Precise</span>
                    <span>Creative</span>
                  </div>
                </fieldset>

                <fieldset className="space-y-3">
                  <label className="flex items-center justify-between text-sm font-medium text-white/70">
                    Max Tokens
                    <span className="rounded bg-white/5 px-2 py-0.5 font-mono text-xs text-violet-300">{config.maxTokens.toLocaleString()}</span>
                  </label>
                  <input
                    type="range"
                    min={256}
                    max={32768}
                    step={256}
                    value={config.maxTokens}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'maxTokens', value: parseInt(e.target.value, 10) })}
                    className="w-full accent-violet-500"
                  />
                  <div className="flex justify-between text-[10px] text-white/30">
                    <span>256</span>
                    <span>32,768</span>
                  </div>
                </fieldset>
              </div>
            </motion.div>
          )}

          {/* ─── Tools Tab ────────────────────────────────────────────── */}
          {activeTab === 'tools' && (
            <motion.div key="tools" {...fadeUp} className="mx-auto max-w-2xl space-y-4 p-6">
              <p className="text-sm text-white/50">Select the tools your agent can use. Drag to reorder priority.</p>

              <Reorder.Group
                axis="y"
                values={config.enabledTools}
                onReorder={(newOrder) => dispatch({ type: 'SET_TOOLS', toolIds: newOrder })}
                className="space-y-2"
              >
                {config.enabledTools.map((toolId) => {
                  const tool = TOOLS.find((t) => t.id === toolId);
                  if (!tool) return null;
                  const Icon = tool.icon;
                  return (
                    <Reorder.Item key={toolId} value={toolId}>
                      <div className="flex items-center gap-3 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3">
                        <GripVertical className="h-4 w-4 cursor-grab text-white/30 active:cursor-grabbing" />
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-500/20">
                          <Icon className="h-4 w-4 text-violet-300" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white">{tool.name}</p>
                          <p className="text-xs text-white/40">{tool.capabilities.join(' · ')}</p>
                        </div>
                        <button
                          onClick={() => dispatch({ type: 'TOGGLE_TOOL', toolId })}
                          className="rounded p-1 text-white/30 transition hover:bg-white/5 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </Reorder.Item>
                  );
                })}
              </Reorder.Group>

              {/* Available tools */}
              <div className="pt-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/30">Available Tools</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {TOOLS.filter((t) => !config.enabledTools.includes(t.id)).map((tool) => {
                    const Icon = tool.icon;
                    return (
                      <motion.button
                        key={tool.id}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => dispatch({ type: 'TOGGLE_TOOL', toolId: tool.id })}
                        className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-left transition hover:border-white/15 hover:bg-white/5"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/5">
                          <Icon className="h-4 w-4 text-white/50" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white">{tool.name}</p>
                          <p className="truncate text-xs text-white/40">{tool.capabilities.join(' · ')}</p>
                        </div>
                        <Plus className="h-4 w-4 text-white/20" />
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {TOOLS.filter((t) => !config.enabledTools.includes(t.id)).length === 0 && (
                <p className="pt-2 text-center text-xs text-white/30">All tools enabled</p>
              )}
            </motion.div>
          )}

          {/* ─── Triggers Tab ─────────────────────────────────────────── */}
          {activeTab === 'triggers' && (
            <motion.div key="triggers" {...fadeUp} className="mx-auto max-w-2xl space-y-6 p-6">
              <p className="text-sm text-white/50">Choose how this agent gets activated.</p>

              <div className="space-y-2">
                {TRIGGER_OPTIONS.map((trigger) => {
                  const Icon = trigger.icon;
                  const active = config.triggerType === trigger.type;
                  return (
                    <button
                      key={trigger.type}
                      onClick={() => dispatch({ type: 'SET_FIELD', field: 'triggerType', value: trigger.type })}
                      className={cn(
                        'flex w-full items-center gap-4 rounded-lg border px-4 py-3.5 text-left transition',
                        active
                          ? 'border-violet-500/40 bg-violet-500/10'
                          : 'border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/5',
                      )}
                    >
                      <div className={cn('flex h-9 w-9 items-center justify-center rounded-md', active ? 'bg-violet-500/20' : 'bg-white/5')}>
                        <Icon className={cn('h-4 w-4', active ? 'text-violet-300' : 'text-white/50')} />
                      </div>
                      <div className="flex-1">
                        <p className={cn('text-sm font-medium', active ? 'text-white' : 'text-white/70')}>{trigger.label}</p>
                        <p className="text-xs text-white/40">{trigger.description}</p>
                      </div>
                      {active && (
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500">
                          <Check className="h-3 w-3 text-white" />
                        </motion.div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Cron builder */}
              <AnimatePresence>
                {config.triggerType === 'cron' && (
                  <motion.div {...fadeUp} className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">
                    <label className="block text-sm font-medium text-white/70">Cron Expression</label>
                    <input
                      type="text"
                      value={config.cronExpression}
                      onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'cronExpression', value: e.target.value })}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 font-mono text-sm text-white placeholder:text-white/25 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                    />
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: 'Every hour', cron: '0 * * * *' },
                        { label: 'Weekdays 9am', cron: '0 9 * * 1-5' },
                        { label: 'Daily midnight', cron: '0 0 * * *' },
                        { label: 'Every 15 min', cron: '*/15 * * * *' },
                      ].map((preset) => (
                        <button
                          key={preset.cron}
                          onClick={() => dispatch({ type: 'SET_FIELD', field: 'cronExpression', value: preset.cron })}
                          className={cn(
                            'rounded-md px-3 py-1.5 text-xs font-medium transition',
                            config.cronExpression === preset.cron
                              ? 'bg-violet-500/20 text-violet-300'
                              : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70',
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Webhook URL display */}
              <AnimatePresence>
                {config.triggerType === 'webhook' && (
                  <motion.div {...fadeUp} className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">
                    <label className="block text-sm font-medium text-white/70">Webhook URL</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded-lg border border-white/10 bg-black/30 px-4 py-2.5 font-mono text-xs text-emerald-400">
                        {webhookUrl}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(webhookUrl)}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-medium text-white/70 transition hover:bg-white/10"
                      >
                        Copy
                      </button>
                    </div>
                    <p className="text-xs text-white/30">Send a POST request to this URL to trigger your agent. The request body will be passed as input.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ─── Test Playground ───────────────────────────────────────── */}
          {activeTab === 'test' && (
            <motion.div key="test" {...fadeUp} className="mx-auto max-w-2xl space-y-6 p-6">
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Play className="h-4 w-4 text-violet-400" />
                  <h3 className="text-sm font-medium text-white">Test Playground</h3>
                  {config.name && <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-white/40">{config.name}</span>}
                </div>

                <textarea
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  placeholder="Enter sample input to test your agent..."
                  rows={4}
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder:text-white/25 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                />

                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-white/30">
                    Model: {selectedModel.label} | Tools: {config.enabledTools.length} | Trigger: {config.triggerType}
                  </p>
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    disabled={testRunning || !testInput.trim()}
                    onClick={handleTest}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
                      testInput.trim() && !testRunning
                        ? 'bg-violet-500 text-white hover:bg-violet-400'
                        : 'cursor-not-allowed bg-white/5 text-white/30',
                    )}
                  >
                    {testRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {testRunning ? 'Running...' : 'Run Test'}
                  </motion.button>
                </div>
              </div>

              {/* Test results */}
              <AnimatePresence>
                {testResult && (
                  <motion.div {...fadeUp} className="space-y-4">
                    {/* Reasoning */}
                    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                      <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                        <Cpu className="h-3.5 w-3.5" /> Reasoning
                      </h4>
                      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-white/70">{testResult.reasoning}</pre>
                    </div>

                    {/* Actions */}
                    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                      <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                        <Wrench className="h-3.5 w-3.5" /> Actions Taken
                      </h4>
                      <ul className="space-y-1">
                        {testResult.actions.map((action, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs text-white/60">
                            <Check className="h-3 w-3 text-emerald-400" />
                            {action}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Response */}
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                      <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400/60">
                        <MessageSquare className="h-3.5 w-3.5" /> Response
                      </h4>
                      <p className="text-sm leading-relaxed text-white/80">{testResult.response}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ─── Template Gallery ──────────────────────────────────────── */}
          {activeTab === 'gallery' && (
            <motion.div key="gallery" {...fadeUp} className="mx-auto max-w-3xl p-6">
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-white">Agent Templates</h2>
                <p className="text-sm text-white/50">Start from a proven template and customize to your needs.</p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {TEMPLATES.map((tpl) => {
                  const Icon = tpl.icon;
                  const model = MODELS.find((m) => m.id === tpl.model);
                  return (
                    <motion.button
                      key={tpl.id}
                      whileHover={{ scale: 1.02, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => loadTemplate(tpl)}
                      className="flex flex-col items-start rounded-xl border border-white/5 bg-white/[0.02] p-5 text-left transition hover:border-violet-500/30 hover:bg-violet-500/5"
                    >
                      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20">
                        <Icon className="h-5 w-5 text-violet-400" />
                      </div>
                      <h3 className="text-sm font-semibold text-white">{tpl.name}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-white/40">{tpl.tagline}</p>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {tpl.tools.slice(0, 3).map((toolId) => {
                          const tool = TOOLS.find((t) => t.id === toolId);
                          return (
                            <span key={toolId} className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/40">
                              {tool?.name ?? toolId}
                            </span>
                          );
                        })}
                        {tpl.tools.length > 3 && (
                          <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/40">+{tpl.tools.length - 3}</span>
                        )}
                      </div>
                      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-white/25">
                        <Cpu className="h-3 w-3" />
                        {model?.label ?? tpl.model}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer status bar */}
      <div className="flex items-center justify-between border-t border-white/10 px-6 py-2.5">
        <div className="flex items-center gap-4 text-xs text-white/30">
          <span className="flex items-center gap-1.5">
            <div className={cn('h-1.5 w-1.5 rounded-full', isValid ? 'bg-emerald-400' : 'bg-amber-400')} />
            {isValid ? 'Ready to deploy' : 'Incomplete configuration'}
          </span>
          {config.enabledTools.length > 0 && (
            <span>{config.enabledTools.length} tool{config.enabledTools.length !== 1 ? 's' : ''} enabled</span>
          )}
        </div>
        <button
          onClick={() => dispatch({ type: 'RESET' })}
          className="flex items-center gap-1 text-xs text-white/25 transition hover:text-white/50"
        >
          <X className="h-3 w-3" /> Reset
        </button>
      </div>
    </div>
  );
}
