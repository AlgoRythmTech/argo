import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Briefcase,
  CalendarCheck,
  Clock,
  Files,
  Layers,
  LifeBuoy,
  Loader2,
  Receipt,
  Search,
  Sparkles,
  UserPlus,
  Webhook,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { templates as templatesApi, type Template } from '../api/client.js';

// ── Icon registry ──────────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  Briefcase,
  CalendarCheck,
  Layers,
  LifeBuoy,
  Receipt,
  Sparkles,
  UserPlus,
  Webhook,
};

function resolveIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Sparkles;
}

// ── Category metadata ──────────────────────────────────────────────────

type Category = 'all' | 'workflow' | 'saas' | 'integration' | 'ai-agent';

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'saas', label: 'SaaS' },
  { key: 'integration', label: 'Integration' },
  { key: 'ai-agent', label: 'AI Agent' },
];

// ── Component ──────────────────────────────────────────────────────────

interface TemplateGalleryProps {
  open: boolean;
  onClose: () => void;
  onUseTemplate: (op: { id: string; slug: string; name: string }) => void;
}

export function TemplateGallery({ open, onClose, onUseTemplate }: TemplateGalleryProps) {
  const [allTemplates, setAllTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<Category>('all');
  const [usingSlug, setUsingSlug] = useState<string | null>(null);

  // Fetch templates when opened.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    templatesApi
      .list()
      .then((data) => {
        setAllTemplates(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(String((err as { message?: string })?.message ?? err).slice(0, 200));
        setLoading(false);
      });
  }, [open]);

  // Filter by category + search.
  const filtered = useMemo(() => {
    let list = allTemplates;
    if (activeCategory !== 'all') {
      list = list.filter((t) => t.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [allTemplates, activeCategory, search]);

  const handleUse = async (slug: string) => {
    setUsingSlug(slug);
    try {
      const op = await templatesApi.use(slug);
      onUseTemplate({ id: op.id, slug: op.slug, name: op.name });
      onClose();
    } catch (err) {
      setError(String((err as { message?: string })?.message ?? err).slice(0, 200));
    } finally {
      setUsingSlug(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="template-gallery-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            key="template-gallery-panel"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-4xl max-h-[85vh] rounded-2xl border border-argo-border bg-argo-bg shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-argo-border">
              <div>
                <div className="flex items-center gap-2 text-argo-accent mb-1">
                  <Sparkles className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-widest font-mono">
                    Template Gallery
                  </span>
                </div>
                <h2 className="text-xl font-semibold text-argo-text">
                  Start from a template
                </h2>
                <p className="text-sm text-argo-textSecondary mt-1">
                  Pre-built operation templates you can deploy in one click. Argo fills in the brief
                  and you can customise before going live.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-argo-textSecondary hover:text-argo-text transition-colors p-1"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Search + category tabs */}
            <div className="px-6 py-3 border-b border-argo-border flex items-center gap-4 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-argo-textSecondary" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search templates..."
                  className="w-full rounded-lg border border-argo-border bg-argo-surface pl-9 pr-3 py-2 text-sm text-argo-text placeholder:text-argo-textSecondary focus:outline-none focus:border-argo-accent/50 focus:ring-1 focus:ring-argo-accent/30 transition-colors"
                />
              </div>
              <div className="flex items-center gap-1">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => setActiveCategory(cat.key)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      activeCategory === cat.key
                        ? 'bg-argo-accent text-argo-bg'
                        : 'text-argo-textSecondary hover:text-argo-text hover:bg-argo-surface'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Template grid */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-6 w-6 animate-spin text-argo-accent" />
                  <span className="ml-3 text-sm text-argo-textSecondary">
                    Loading templates...
                  </span>
                </div>
              ) : error ? (
                <div className="text-center py-20">
                  <p className="text-sm text-argo-amber">{error}</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-20">
                  <p className="text-sm text-argo-textSecondary">
                    No templates match your search.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {filtered.map((tpl, i) => {
                    const Icon = resolveIcon(tpl.icon);
                    const isUsing = usingSlug === tpl.slug;
                    return (
                      <motion.div
                        key={tpl.slug}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.25,
                          delay: 0.03 * i,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        className="group rounded-xl border border-argo-border bg-argo-surface/40 hover:bg-argo-surface hover:border-argo-accent/40 transition-colors p-4 flex flex-col"
                      >
                        {/* Top row: icon + name + category */}
                        <div className="flex items-start gap-3 mb-3">
                          <span className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-argo-accent/15 text-argo-accent flex-shrink-0">
                            <Icon className="h-5 w-5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-argo-text font-semibold leading-snug">
                              {tpl.name}
                            </div>
                            <div className="text-[10px] uppercase tracking-widest text-argo-textSecondary/60 font-mono mt-0.5">
                              {tpl.category.replace('-', ' ')}
                            </div>
                          </div>
                        </div>

                        {/* Description */}
                        <p className="text-argo-textSecondary text-xs leading-relaxed mb-3 flex-1">
                          {tpl.description}
                        </p>

                        {/* Features */}
                        <ul className="space-y-1 mb-3">
                          {tpl.features.slice(0, 4).map((feat) => (
                            <li
                              key={feat}
                              className="text-[11px] text-argo-textSecondary flex items-start gap-1.5"
                            >
                              <span className="text-argo-accent mt-0.5 flex-shrink-0">
                                &bull;
                              </span>
                              {feat}
                            </li>
                          ))}
                        </ul>

                        {/* Tags */}
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {tpl.tags.slice(0, 5).map((tag) => (
                            <span
                              key={tag}
                              className="inline-block rounded-full bg-argo-accent/10 text-argo-accent px-2 py-0.5 text-[10px] font-mono"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>

                        {/* Footer: metadata + action */}
                        <div className="flex items-center justify-between pt-2 border-t border-argo-border/50">
                          <div className="flex items-center gap-3 text-[11px] text-argo-textSecondary">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {tpl.estimatedBuildTime}
                            </span>
                            <span className="flex items-center gap-1">
                              <Files className="h-3 w-3" />
                              {tpl.fileCount} files
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleUse(tpl.slug)}
                            disabled={isUsing || usingSlug !== null}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-argo-accent text-argo-bg px-3 py-1.5 text-xs font-semibold hover:bg-argo-accent/90 transition-colors disabled:opacity-60"
                          >
                            {isUsing ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              'Use Template'
                            )}
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
