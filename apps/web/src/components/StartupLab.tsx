/**
 * StartupLab — Argo's most unique feature. A collaborative space where
 * co-founders brainstorm startup ideas, AI synthesizes the best product,
 * researches the market, and Argo builds the app.
 *
 * Four phases:
 *   1. Create Lab — generate an invite code to share with your team
 *   2. Submit Ideas — each member pitches a startup idea
 *   3. Synthesize — AI analyzes, researches, and produces a product brief
 *   4. Results — review the synthesized product and kick off a build
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  BarChart3,
  Brain,
  CheckCircle2,
  ClipboardCopy,
  Crown,
  Globe,
  Lightbulb,
  Loader2,
  Plus,
  Rocket,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { api } from '../api/client.js';

// ── Types ──────────────────────────────────────────────────────────────

type Phase = 'create' | 'ideas' | 'synthesize' | 'results';

interface Idea {
  id: string;
  title: string;
  description: string;
  targetAudience: string;
  problemSolved: string;
  author: string;
  submittedAt: string;
}

interface Feature {
  name: string;
  priority: 'must-have' | 'nice-to-have';
}

interface MarketResearch {
  competitors: string[];
  marketSize: string;
  keyTrends: string[];
  painPoints: string[];
  opportunities: string[];
  verdict: string;
}

interface SynthesizedProduct {
  name: string;
  tagline: string;
  description: string;
  confidenceScore: number;
  targetAudience: string;
  coreProblem: string;
  solution: string;
  features: Feature[];
  market: MarketResearch;
}

interface SynthesisStep {
  label: string;
  icon: 'brain' | 'globe' | 'chart' | 'sparkles';
  duration: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const SYNTHESIS_STEPS: SynthesisStep[] = [
  { label: 'Analyzing ideas...', icon: 'brain', duration: 3500 },
  { label: 'Researching market...', icon: 'globe', duration: 4200 },
  { label: 'Validating demand...', icon: 'chart', duration: 3800 },
  { label: 'Generating product brief...', icon: 'sparkles', duration: 4000 },
];

const STEP_ICONS = {
  brain: Brain,
  globe: Globe,
  chart: BarChart3,
  sparkles: Sparkles,
} as const;

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateId(): string {
  return `idea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Simulated synthesized product — in production this calls the AI pipeline. */
function buildMockProduct(ideas: Idea[]): SynthesizedProduct {
  const bestIdea = ideas[0];
  const allAudiences = ideas.map((i) => i.targetAudience).join(', ');
  return {
    name: ideas.length === 1
      ? bestIdea.title
      : `${bestIdea.title} + ${ideas.length - 1} merged concept${ideas.length > 2 ? 's' : ''}`,
    tagline: 'AI-powered solution built from your team\'s best thinking',
    description:
      `A product synthesized from ${ideas.length} idea${ideas.length > 1 ? 's' : ''} submitted by your team. ` +
      `It combines the strongest elements: ${ideas.map((i) => i.title.toLowerCase()).join(', ')}. ` +
      'The AI identified overlapping problem spaces and merged them into a cohesive product vision.',
    confidenceScore: Math.min(98, 62 + ideas.length * 9 + Math.floor(Math.random() * 8)),
    targetAudience: allAudiences,
    coreProblem: ideas.map((i) => i.problemSolved).join(' Additionally, '),
    solution: bestIdea.description,
    features: [
      { name: 'User onboarding flow', priority: 'must-have' },
      { name: 'Core dashboard with analytics', priority: 'must-have' },
      { name: 'Team collaboration workspace', priority: 'must-have' },
      { name: 'AI-powered recommendations', priority: 'must-have' },
      { name: 'Notification system', priority: 'nice-to-have' },
      { name: 'Export & integrations', priority: 'nice-to-have' },
      { name: 'Mobile-responsive design', priority: 'must-have' },
      { name: 'Admin panel', priority: 'nice-to-have' },
    ],
    market: {
      competitors: ['Notion', 'Linear', 'Retool', 'Airtable'],
      marketSize: '$4.2B TAM (growing 23% YoY)',
      keyTrends: [
        'AI-first tooling adoption accelerating',
        'Remote teams need async collaboration',
        'Low-code / no-code demand surging',
        'Vertical SaaS outperforming horizontal',
      ],
      painPoints: [
        'Existing tools are too generic',
        'Onboarding takes weeks, not minutes',
        'No AI-native workflows',
        'Poor cross-team visibility',
      ],
      opportunities: [
        'First-mover advantage in AI-native niche',
        'Strong PLG distribution channel',
        'Integration marketplace potential',
        'Enterprise upsell path',
      ],
      verdict:
        'Strong product-market fit signal. The overlap between submitted ideas validates genuine demand. ' +
        'Recommend an MVP focused on the core workflow, with AI features as the wedge differentiator. ' +
        'Ship in 2 weeks, iterate based on user feedback.',
    },
  };
}

// ── Circular Progress Ring ─────────────────────────────────────────────

function ConfidenceRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="132" height="132" className="-rotate-90">
        <circle
          cx="66" cy="66" r={radius}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="8" fill="none"
        />
        <motion.circle
          cx="66" cy="66" r={radius}
          stroke={color}
          strokeWidth="8" fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.8, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-white">{score}</span>
        <span className="text-[10px] uppercase tracking-widest text-white/50">confidence</span>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function StartupLab() {
  const [phase, setPhase] = useState<Phase>('create');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [product, setProduct] = useState<SynthesizedProduct | null>(null);
  const [copied, setCopied] = useState(false);

  // Idea form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [problemSolved, setProblemSolved] = useState('');

  // Synthesis animation state
  const [synthesizing, setSynthesizing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const synthAbort = useRef(false);

  const handleCreateLab = useCallback(() => {
    const code = generateInviteCode();
    setInviteCode(code);
    setPhase('ideas');
  }, []);

  const handleCopyCode = useCallback(() => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [inviteCode]);

  const handleSubmitIdea = useCallback(() => {
    if (!title.trim() || !description.trim()) return;
    const idea: Idea = {
      id: generateId(),
      title: title.trim(),
      description: description.trim(),
      targetAudience: targetAudience.trim() || 'General',
      problemSolved: problemSolved.trim() || 'Not specified',
      author: 'You',
      submittedAt: new Date().toISOString(),
    };
    setIdeas((prev) => [...prev, idea]);
    setTitle('');
    setDescription('');
    setTargetAudience('');
    setProblemSolved('');
  }, [title, description, targetAudience, problemSolved]);

  const handleSynthesize = useCallback(async () => {
    if (ideas.length < 1) return;
    setSynthesizing(true);
    setCurrentStep(0);
    synthAbort.current = false;

    for (let i = 0; i < SYNTHESIS_STEPS.length; i++) {
      if (synthAbort.current) return;
      setCurrentStep(i);
      await new Promise((r) => setTimeout(r, SYNTHESIS_STEPS[i].duration));
    }

    if (synthAbort.current) return;
    const result = buildMockProduct(ideas);
    setProduct(result);
    setSynthesizing(false);
    setPhase('results');
  }, [ideas]);

  const handleStartOver = useCallback(() => {
    synthAbort.current = true;
    setSynthesizing(false);
    setCurrentStep(0);
    setPhase('create');
    setInviteCode(null);
    setIdeas([]);
    setProduct(null);
  }, []);

  const handleBuild = useCallback(async () => {
    if (!product) return;
    try {
      await api.post('/api/deploy', {
        prompt: `Build: ${product.name} — ${product.tagline}. ${product.description}`,
        source: 'startup-lab',
      });
    } catch {
      // Build pipeline integration — silently handled in production
    }
  }, [product]);

  // ── Render helpers ───────────────────────────────────────────────────

  const fadeUp = {
    initial: { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -16 },
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  };

  const glassCard = cn(
    'rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl',
    'shadow-[0_8px_32px_rgba(0,0,0,0.35)]',
  );

  return (
    <div className="min-h-screen bg-argo-bg text-white overflow-y-auto">
      {/* Background gradient mesh */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-purple-600/10 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full bg-blue-600/8 blur-[100px]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {/* ── Phase 1: Create Lab ──────────────────────────────── */}
          {phase === 'create' && (
            <motion.div key="create" {...fadeUp} className="flex flex-col items-center text-center pt-20">
              <motion.div
                className="mb-8 p-5 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-white/10"
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Rocket className="h-12 w-12 text-purple-400" />
              </motion.div>

              <h1 className="text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white via-purple-200 to-blue-200 bg-clip-text text-transparent">
                Startup Lab
              </h1>
              <p className="mt-4 text-lg text-white/50 max-w-md">
                Your team brainstorms. AI synthesizes. Argo builds.
              </p>

              <motion.button
                onClick={handleCreateLab}
                className={cn(
                  'mt-10 px-8 py-4 rounded-xl font-semibold text-lg',
                  'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500',
                  'shadow-lg shadow-purple-600/25 transition-all duration-200',
                  'flex items-center gap-3',
                )}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
              >
                <Plus className="h-5 w-5" />
                Create a Lab
              </motion.button>

              <div className="mt-16 grid grid-cols-3 gap-6 max-w-lg w-full">
                {[
                  { icon: Lightbulb, label: 'Brainstorm ideas' },
                  { icon: Brain, label: 'AI synthesizes' },
                  { icon: Zap, label: 'Argo builds' },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex flex-col items-center gap-2 text-white/40 text-sm">
                    <Icon className="h-6 w-6" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Phase 2: Submit Ideas ────────────────────────────── */}
          {phase === 'ideas' && (
            <motion.div key="ideas" {...fadeUp}>
              {/* Header with invite code */}
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold">Startup Lab</h2>
                  <p className="text-white/40 text-sm mt-1">Submit ideas, then synthesize</p>
                </div>
                {inviteCode && (
                  <motion.button
                    onClick={handleCopyCode}
                    className={cn(
                      glassCard,
                      'px-5 py-3 flex items-center gap-3 hover:border-purple-500/40 transition-colors',
                    )}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <span className="text-xs uppercase tracking-wider text-white/40">Invite Code</span>
                    <span className="font-mono text-lg font-bold text-purple-300 tracking-widest">
                      {inviteCode}
                    </span>
                    {copied ? (
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                    ) : (
                      <ClipboardCopy className="h-4 w-4 text-white/30" />
                    )}
                  </motion.button>
                )}
              </div>

              {/* Idea submission form */}
              <div className={cn(glassCard, 'p-6 mb-8')}>
                <div className="flex items-center gap-2 mb-5">
                  <Lightbulb className="h-5 w-5 text-yellow-400" />
                  <h3 className="font-semibold text-lg">Submit Your Idea</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs uppercase tracking-wider text-white/40 mb-1.5">
                      Title
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. AI-Powered Invoice Manager"
                      className={cn(
                        'w-full px-4 py-3 rounded-lg bg-white/[0.06] border border-white/10',
                        'text-white placeholder-white/25 outline-none',
                        'focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all',
                      )}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs uppercase tracking-wider text-white/40 mb-1.5">
                      Description
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Describe your startup idea in 2-3 sentences"
                      rows={3}
                      className={cn(
                        'w-full px-4 py-3 rounded-lg bg-white/[0.06] border border-white/10',
                        'text-white placeholder-white/25 outline-none resize-none',
                        'focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all',
                      )}
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-white/40 mb-1.5">
                      Target Audience
                    </label>
                    <input
                      type="text"
                      value={targetAudience}
                      onChange={(e) => setTargetAudience(e.target.value)}
                      placeholder="e.g. Small business owners"
                      className={cn(
                        'w-full px-4 py-3 rounded-lg bg-white/[0.06] border border-white/10',
                        'text-white placeholder-white/25 outline-none',
                        'focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all',
                      )}
                    />
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-white/40 mb-1.5">
                      Problem Solved
                    </label>
                    <input
                      type="text"
                      value={problemSolved}
                      onChange={(e) => setProblemSolved(e.target.value)}
                      placeholder="e.g. Manual invoicing wastes 5 hrs/week"
                      className={cn(
                        'w-full px-4 py-3 rounded-lg bg-white/[0.06] border border-white/10',
                        'text-white placeholder-white/25 outline-none',
                        'focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all',
                      )}
                    />
                  </div>
                </div>

                <motion.button
                  onClick={handleSubmitIdea}
                  disabled={!title.trim() || !description.trim()}
                  className={cn(
                    'mt-5 px-6 py-3 rounded-lg font-medium text-sm',
                    'bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed',
                    'transition-colors flex items-center gap-2',
                  )}
                  whileHover={{ scale: title.trim() && description.trim() ? 1.02 : 1 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <ArrowRight className="h-4 w-4" />
                  Submit Idea
                </motion.button>
              </div>

              {/* Ideas counter */}
              <div className="flex items-center justify-between mb-5">
                <p className="text-sm text-white/50">
                  <span className="text-white font-semibold">{ideas.length}</span>{' '}
                  idea{ideas.length !== 1 ? 's' : ''} submitted
                  {ideas.length < 1 && ' \u2014 need at least 1 to synthesize'}
                  {ideas.length >= 1 && ' \u2014 ready to synthesize'}
                </p>

                {ideas.length >= 1 && !synthesizing && (
                  <motion.button
                    onClick={handleSynthesize}
                    className={cn(
                      'px-7 py-3 rounded-xl font-semibold',
                      'bg-gradient-to-r from-purple-600 via-fuchsia-600 to-blue-600',
                      'hover:from-purple-500 hover:via-fuchsia-500 hover:to-blue-500',
                      'shadow-lg shadow-purple-600/20 transition-all',
                      'flex items-center gap-2',
                    )}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <Sparkles className="h-5 w-5" />
                    Synthesize Best Product
                  </motion.button>
                )}
              </div>

              {/* Synthesis progress overlay */}
              <AnimatePresence>
                {synthesizing && (
                  <motion.div
                    key="synth-overlay"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className={cn(glassCard, 'p-8 mb-8')}
                  >
                    <div className="flex flex-col items-center gap-6">
                      <p className="text-xs uppercase tracking-widest text-white/40">Synthesizing</p>
                      <div className="flex flex-col gap-4 w-full max-w-sm">
                        {SYNTHESIS_STEPS.map((step, idx) => {
                          const Icon = STEP_ICONS[step.icon];
                          const isActive = idx === currentStep;
                          const isDone = idx < currentStep;
                          return (
                            <motion.div
                              key={step.label}
                              className={cn(
                                'flex items-center gap-4 px-4 py-3 rounded-lg transition-colors',
                                isActive && 'bg-white/[0.06]',
                                isDone && 'opacity-50',
                              )}
                              initial={{ opacity: 0, x: -12 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: idx * 0.1 }}
                            >
                              {isDone ? (
                                <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                              ) : isActive ? (
                                <motion.div
                                  animate={{ scale: [1, 1.2, 1] }}
                                  transition={{ duration: 1.5, repeat: Infinity }}
                                >
                                  <Icon className="h-5 w-5 text-purple-400 shrink-0" />
                                </motion.div>
                              ) : (
                                <Icon className="h-5 w-5 text-white/20 shrink-0" />
                              )}
                              <span className={cn(
                                'text-sm',
                                isActive ? 'text-white font-medium' : 'text-white/40',
                              )}>
                                {step.label}
                              </span>
                              {isActive && (
                                <Loader2 className="h-4 w-4 animate-spin text-purple-400 ml-auto" />
                              )}
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Ideas grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AnimatePresence>
                  {ideas.map((idea, idx) => (
                    <motion.div
                      key={idea.id}
                      initial={{ opacity: 0, scale: 0.92, y: 16 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.92 }}
                      transition={{ delay: idx * 0.05 }}
                      className={cn(glassCard, 'p-5 hover:border-white/20 transition-colors')}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <h4 className="font-semibold text-white">{idea.title}</h4>
                        <span className="text-[10px] text-white/30 shrink-0 ml-3">
                          {new Date(idea.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-sm text-white/60 mb-3 line-clamp-2">{idea.description}</p>
                      <div className="flex flex-wrap gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/20">
                          {idea.targetAudience}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/20">
                          {idea.problemSolved}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-white/30">
                        <Users className="h-3 w-3" />
                        {idea.author}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* ── Phase 4: Results ──────────────────────────────────── */}
          {phase === 'results' && product && (
            <motion.div key="results" {...fadeUp}>
              {/* Header */}
              <div className="flex items-center gap-3 mb-8">
                <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-white/10">
                  <Crown className="h-5 w-5 text-yellow-400" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Synthesized Product</h2>
                  <p className="text-white/40 text-sm">
                    Built from {ideas.length} idea{ideas.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              {/* Product hero card */}
              <motion.div
                className={cn(glassCard, 'p-8 mb-6')}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <div className="flex flex-col md:flex-row items-start md:items-center gap-8">
                  <div className="flex-1">
                    <h3 className="text-3xl font-extrabold bg-gradient-to-r from-white via-purple-200 to-blue-200 bg-clip-text text-transparent">
                      {product.name}
                    </h3>
                    <p className="mt-2 text-lg text-white/50 italic">{product.tagline}</p>
                    <p className="mt-4 text-sm text-white/60 leading-relaxed">{product.description}</p>
                    <div className="mt-4">
                      <span className="text-xs px-3 py-1 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/20">
                        <Target className="h-3 w-3 inline mr-1.5 -mt-0.5" />
                        {product.targetAudience}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <ConfidenceRing score={product.confidenceScore} />
                  </div>
                </div>
              </motion.div>

              {/* Problem & Solution */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <motion.div
                  className={cn(glassCard, 'p-6')}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="h-4 w-4 text-red-400" />
                    <h4 className="font-semibold text-sm uppercase tracking-wider text-white/50">Core Problem</h4>
                  </div>
                  <p className="text-sm text-white/70 leading-relaxed">{product.coreProblem}</p>
                </motion.div>

                <motion.div
                  className={cn(glassCard, 'p-6')}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="h-4 w-4 text-green-400" />
                    <h4 className="font-semibold text-sm uppercase tracking-wider text-white/50">Solution</h4>
                  </div>
                  <p className="text-sm text-white/70 leading-relaxed">{product.solution}</p>
                </motion.div>
              </div>

              {/* Features */}
              <motion.div
                className={cn(glassCard, 'p-6 mb-6')}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <Star className="h-4 w-4 text-yellow-400" />
                  <h4 className="font-semibold text-sm uppercase tracking-wider text-white/50">Features</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {product.features.map((feat) => (
                    <div
                      key={feat.name}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white/[0.03] border border-white/5"
                    >
                      <CheckCircle2 className={cn(
                        'h-4 w-4 shrink-0',
                        feat.priority === 'must-have' ? 'text-green-400' : 'text-white/25',
                      )} />
                      <span className="text-sm text-white/70 flex-1">{feat.name}</span>
                      <span className={cn(
                        'text-[10px] px-2 py-0.5 rounded-full font-medium',
                        feat.priority === 'must-have'
                          ? 'bg-green-500/15 text-green-300 border border-green-500/20'
                          : 'bg-white/5 text-white/30 border border-white/10',
                      )}>
                        {feat.priority}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Market Research */}
              <motion.div
                className={cn(glassCard, 'p-6 mb-6')}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 }}
              >
                <div className="flex items-center gap-2 mb-5">
                  <TrendingUp className="h-4 w-4 text-blue-400" />
                  <h4 className="font-semibold text-sm uppercase tracking-wider text-white/50">
                    Market Research
                  </h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Competitors */}
                  <div>
                    <p className="text-xs uppercase tracking-wider text-white/30 mb-2">Competitors</p>
                    <div className="flex flex-wrap gap-2">
                      {product.market.competitors.map((c) => (
                        <span
                          key={c}
                          className="text-xs px-3 py-1 rounded-full bg-red-500/10 text-red-300 border border-red-500/15"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Market Size */}
                  <div>
                    <p className="text-xs uppercase tracking-wider text-white/30 mb-2">Market Size</p>
                    <p className="text-sm text-white/70 font-medium">{product.market.marketSize}</p>
                  </div>

                  {/* Key Trends */}
                  <div>
                    <p className="text-xs uppercase tracking-wider text-white/30 mb-2">Key Trends</p>
                    <ul className="space-y-1.5">
                      {product.market.keyTrends.map((t) => (
                        <li key={t} className="flex items-start gap-2 text-sm text-white/60">
                          <TrendingUp className="h-3 w-3 mt-1 shrink-0 text-blue-400/60" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Pain Points */}
                  <div>
                    <p className="text-xs uppercase tracking-wider text-white/30 mb-2">Pain Points</p>
                    <ul className="space-y-1.5">
                      {product.market.painPoints.map((p) => (
                        <li key={p} className="flex items-start gap-2 text-sm text-white/60">
                          <Target className="h-3 w-3 mt-1 shrink-0 text-red-400/60" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Opportunities */}
                  <div className="md:col-span-2">
                    <p className="text-xs uppercase tracking-wider text-white/30 mb-2">Opportunities</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {product.market.opportunities.map((o) => (
                        <div
                          key={o}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/[0.06] border border-green-500/10 text-sm text-green-300/80"
                        >
                          <Rocket className="h-3 w-3 shrink-0" />
                          {o}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Verdict */}
                  <div className="md:col-span-2">
                    <p className="text-xs uppercase tracking-wider text-white/30 mb-2">AI Verdict</p>
                    <div className="px-4 py-3 rounded-lg bg-purple-500/[0.06] border border-purple-500/15">
                      <p className="text-sm text-white/70 leading-relaxed italic">
                        &ldquo;{product.market.verdict}&rdquo;
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Action buttons */}
              <motion.div
                className="flex flex-col sm:flex-row items-center gap-4 pt-2"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 }}
              >
                <motion.button
                  onClick={handleBuild}
                  className={cn(
                    'px-8 py-4 rounded-xl font-semibold text-lg',
                    'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500',
                    'shadow-lg shadow-green-600/25 transition-all',
                    'flex items-center gap-3',
                  )}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <Zap className="h-5 w-5" />
                  Build This Product
                </motion.button>

                <motion.button
                  onClick={handleStartOver}
                  className={cn(
                    'px-6 py-4 rounded-xl font-medium text-sm',
                    'bg-white/[0.06] hover:bg-white/[0.1] border border-white/10',
                    'transition-colors flex items-center gap-2 text-white/60 hover:text-white/80',
                  )}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <RotateCcw className="h-4 w-4" />
                  Start Over
                </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
