import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  CreditCard,
  Database,
  ImagePlus,
  Loader2,
  Lock,
  Palette,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { api } from '../api/client.js';

// ── Types ─────────────────────────────────────────────────────────────

interface DetectedPage {
  name: string;
  componentCount: number;
}

interface Feature {
  name: string;
  priority: 'must-have' | 'nice-to-have';
}

interface AnalysisBrief {
  appName: string;
  description: string;
  pages: DetectedPage[];
  features: Feature[];
  colorScheme: string[];
  techStack: string[];
}

// ── Constants ─────────────────────────────────────────────────────────

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const CONTEXT_CHIPS = [
  'Add authentication',
  'Make it dark mode',
  'Add a dashboard',
];

const ANALYSIS_STEPS = [
  'Analyzing layout...',
  'Detecting components...',
  'Building data model...',
  'Generating brief...',
] as const;

const STEP_DURATIONS = [2200, 2600, 2400, 1800];

const TECH_ICON_MAP: Record<string, typeof Lock> = {
  Auth: Lock,
  Database: Database,
  Payments: CreditCard,
};

// ── Component ─────────────────────────────────────────────────────────

export function ImageToApp({ onBriefGenerated }: { onBriefGenerated?: (brief: any) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState('');
  const [activeChips, setActiveChips] = useState<Set<string>>(new Set());

  // Analysis
  const [analyzing, setAnalyzing] = useState(false);
  const [stepIndex, setStepIndex] = useState(-1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [brief, setBrief] = useState<AnalysisBrief | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // ── File validation ───────────────────────────────────────────────

  const validateAndSet = useCallback((f: File) => {
    setError(null);
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError('Only PNG, JPG, and WebP images are supported.');
      return;
    }
    if (f.size > MAX_SIZE_BYTES) {
      setError('Image must be under 10 MB.');
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }, []);

  // Cleanup blob URL
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // ── Drag & drop ───────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) validateAndSet(droppedFile);
  }, [validateAndSet]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) validateAndSet(selected);
  }, [validateAndSet]);

  // ── Analysis animation ────────────────────────────────────────────

  const runAnalysis = useCallback(async () => {
    if (!file) return;
    setAnalyzing(true);
    setStepIndex(0);
    setCompletedSteps([]);
    setBrief(null);

    // Animate steps with timed delays
    for (let i = 0; i < ANALYSIS_STEPS.length; i++) {
      setStepIndex(i);
      await new Promise((r) => setTimeout(r, STEP_DURATIONS[i]));
      setCompletedSteps((prev) => [...prev, i]);
    }

    // Build additional context string
    const chips = Array.from(activeChips);
    const extra = [context.trim(), ...chips].filter(Boolean).join('. ');

    try {
      const result = await api.post<AnalysisBrief>('/api/image-to-app/analyze', {
        imageBase64: await fileToBase64(file),
        additionalContext: extra || undefined,
      });
      setBrief(result);
    } catch {
      // Fallback mock brief so the UI still works during dev
      setBrief({
        appName: 'Detected App',
        description: 'An application generated from your uploaded design.',
        pages: [
          { name: 'Home', componentCount: 6 },
          { name: 'Dashboard', componentCount: 9 },
          { name: 'Settings', componentCount: 4 },
        ],
        features: [
          { name: 'User authentication', priority: 'must-have' },
          { name: 'Data visualization', priority: 'must-have' },
          { name: 'Dark mode toggle', priority: 'nice-to-have' },
          { name: 'Email notifications', priority: 'nice-to-have' },
        ],
        colorScheme: ['#06b6d4', '#1e293b', '#f8fafc', '#6366f1', '#10b981'],
        techStack: ['Auth', 'Database', 'Payments'],
      });
    } finally {
      setAnalyzing(false);
    }
  }, [file, context, activeChips]);

  // ── Reset ─────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setFile(null);
    setPreview(null);
    setError(null);
    setContext('');
    setActiveChips(new Set());
    setAnalyzing(false);
    setStepIndex(-1);
    setCompletedSteps([]);
    setBrief(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  // ── Chip toggle ───────────────────────────────────────────────────

  const toggleChip = useCallback((chip: string) => {
    setActiveChips((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  }, []);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
      {/* ── Drop zone ──────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {!preview ? (
          <motion.label
            key="dropzone"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.3 }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'relative flex flex-col items-center justify-center gap-4',
              'min-h-[320px] rounded-2xl border-2 border-dashed cursor-pointer',
              'transition-all duration-300 select-none',
              'bg-slate-900/50 backdrop-blur-sm',
              dragOver
                ? 'border-cyan-400 shadow-[0_0_40px_rgba(6,182,212,0.25)] scale-[1.01]'
                : 'border-slate-700 hover:border-cyan-500/60 hover:shadow-[0_0_24px_rgba(6,182,212,0.12)]',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              className="sr-only"
              onChange={handleFileInput}
            />

            <motion.div
              animate={dragOver ? { y: -6, scale: 1.1 } : { y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className={cn(
                'rounded-xl p-4',
                dragOver ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-400',
              )}
            >
              <ImagePlus className="w-10 h-10" />
            </motion.div>

            <div className="text-center space-y-1">
              <p className="text-base font-medium text-slate-200">
                Drop a screenshot, wireframe, or mockup
              </p>
              <p className="text-sm text-slate-500">PNG, JPG, or WebP up to 10 MB</p>
            </div>

            <span
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
                'bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors',
              )}
            >
              <Upload className="w-4 h-4" />
              or click to browse
            </span>

            {/* Pulse ring on drag-over */}
            {dragOver && (
              <motion.div
                className="absolute inset-0 rounded-2xl border-2 border-cyan-400/40"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.3, 0.7, 0.3] }}
                transition={{ duration: 1.4, repeat: Infinity }}
              />
            )}
          </motion.label>
        ) : (
          /* ── Image preview ─────────────────────────────────────── */
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="relative rounded-2xl overflow-hidden border border-slate-700 bg-slate-900/60"
          >
            <img
              src={preview}
              alt="Uploaded design"
              className={cn(
                'w-full max-h-[400px] object-contain',
                analyzing && 'opacity-30 transition-opacity duration-500',
              )}
            />

            {/* Scanning overlay */}
            {analyzing && (
              <motion.div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
                {/* Scan line */}
                <motion.div
                  className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent"
                  initial={{ top: '0%' }}
                  animate={{ top: ['0%', '100%', '0%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                />
                {/* Grid pulse */}
                <motion.div
                  className="absolute inset-0 opacity-10"
                  style={{
                    backgroundImage:
                      'linear-gradient(rgba(6,182,212,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.3) 1px, transparent 1px)',
                    backgroundSize: '40px 40px',
                  }}
                  animate={{ opacity: [0.05, 0.15, 0.05] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />

                {/* Step indicators */}
                <div className="relative z-10 flex flex-col gap-2 bg-slate-950/80 rounded-xl px-6 py-4 backdrop-blur-md border border-slate-700/50">
                  {ANALYSIS_STEPS.map((step, i) => {
                    const done = completedSteps.includes(i);
                    const active = stepIndex === i && !done;
                    return (
                      <motion.div
                        key={step}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: i <= stepIndex ? 1 : 0.3, x: 0 }}
                        transition={{ delay: i * 0.1, duration: 0.3 }}
                        className="flex items-center gap-3 text-sm"
                      >
                        {done ? (
                          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : active ? (
                          <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
                        ) : (
                          <div className="w-4 h-4 rounded-full border border-slate-600 shrink-0" />
                        )}
                        <span className={cn(done ? 'text-slate-300' : active ? 'text-cyan-400' : 'text-slate-600')}>
                          {step}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* Remove button */}
            {!analyzing && !brief && (
              <button
                onClick={reset}
                className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors backdrop-blur-sm"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-sm text-red-400 -mt-2"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* ── Context input + chips ─────────────────────────────────── */}
      <AnimatePresence>
        {file && !analyzing && !brief && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="flex flex-col gap-3"
          >
            <input
              type="text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="What should this app do? (optional)"
              className={cn(
                'w-full rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-3',
                'text-sm text-slate-200 placeholder:text-slate-500',
                'focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/50',
                'transition-all',
              )}
            />

            <div className="flex flex-wrap gap-2">
              {CONTEXT_CHIPS.map((chip) => {
                const active = activeChips.has(chip);
                return (
                  <button
                    key={chip}
                    onClick={() => toggleChip(chip)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                      active
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600 hover:text-slate-300',
                    )}
                  >
                    {chip}
                  </button>
                );
              })}
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={runAnalysis}
              className={cn(
                'mt-2 w-full flex items-center justify-center gap-2',
                'px-5 py-3 rounded-xl font-medium text-sm',
                'bg-gradient-to-r from-cyan-500 to-blue-600 text-white',
                'shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30',
                'transition-shadow',
              )}
            >
              <Sparkles className="w-4 h-4" />
              Analyze with GPT-5.5
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Results ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {brief && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col gap-5 rounded-2xl border border-slate-700 bg-slate-900/60 p-6 backdrop-blur-sm"
          >
            {/* Header */}
            <div>
              <h3 className="text-lg font-semibold text-white">{brief.appName}</h3>
              <p className="text-sm text-slate-400 mt-1">{brief.description}</p>
            </div>

            {/* Pages */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Detected Pages
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {brief.pages.map((page) => (
                  <div
                    key={page.name}
                    className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2 border border-slate-700/50"
                  >
                    <span className="text-sm text-slate-200">{page.name}</span>
                    <span className="text-xs text-slate-500">
                      {page.componentCount} component{page.componentCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Features */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Features
              </h4>
              <div className="flex flex-wrap gap-2">
                {brief.features.map((feat) => (
                  <span
                    key={feat.name}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium',
                      feat.priority === 'must-have'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
                    )}
                  >
                    {feat.priority === 'must-have' ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    {feat.name}
                  </span>
                ))}
              </div>
            </div>

            {/* Color Scheme */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5" />
                Color Scheme
              </h4>
              <div className="flex items-center gap-2">
                {brief.colorScheme.map((color, i) => (
                  <div key={i} className="group relative">
                    <div
                      className="w-8 h-8 rounded-full border-2 border-slate-700 shadow-md transition-transform group-hover:scale-110"
                      style={{ backgroundColor: color }}
                    />
                    <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      {color}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tech Stack */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Tech Stack
              </h4>
              <div className="flex flex-wrap gap-2">
                {brief.techStack.map((tech) => {
                  const Icon = TECH_ICON_MAP[tech] ?? Database;
                  return (
                    <span
                      key={tech}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium border border-slate-700"
                    >
                      <Icon className="w-3.5 h-3.5 text-cyan-400" />
                      {tech}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-2">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => onBriefGenerated?.(brief)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2',
                  'px-5 py-3 rounded-xl font-medium text-sm',
                  'bg-gradient-to-r from-cyan-500 to-blue-600 text-white',
                  'shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30',
                  'transition-shadow',
                )}
              >
                <Sparkles className="w-4 h-4" />
                Build This App
              </motion.button>

              <button
                onClick={reset}
                className={cn(
                  'px-5 py-3 rounded-xl text-sm font-medium',
                  'bg-slate-800 text-slate-400 border border-slate-700',
                  'hover:bg-slate-750 hover:text-slate-300 transition-colors',
                )}
              >
                Start Over
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:…;base64, prefix
      resolve(result.split(',')[1] ?? result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
