// Cmd-K command palette — investor-grade UX. Jump to any operation,
// trigger a re-deploy, copy a public URL, sign out. The whole product
// surface fits in one keystroke.
//
// Implementation: a portal'd modal with a fuzzy search input + a virtualised
// list of commands. Open via Cmd+K (Mac) / Ctrl+K (others), Esc to close.

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Copy,
  ExternalLink,
  LogOut,
  Plus,
  Repeat,
  Search,
  Wrench,
} from 'lucide-react';
import { useArgo } from '../state/store.js';
import { auth, operations } from '../api/client.js';
import { cn } from '../lib/utils.js';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: 'navigate' | 'operation' | 'system';
  icon: React.ComponentType<{ className?: string }>;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const ops = useArgo((s) => s.operations);
  const setActiveId = useArgo((s) => s.setActiveOperation);
  const setView = useArgo((s) => s.setView);
  const setMe = useArgo((s) => s.setMe);

  // Keyboard wiring — open with Cmd+K / Ctrl+K, close with Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isToggle = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isToggle) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus input on open + reset query.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands: Command[] = useMemo(() => {
    const cmds: Command[] = [];

    cmds.push({
      id: 'new-operation',
      label: 'New operation',
      hint: 'Scope and build a new workflow',
      group: 'navigate',
      icon: Plus,
      run: () => {
        // The Workspace listens for this — it pops the create modal.
        window.dispatchEvent(new CustomEvent('argo:new-operation'));
        setOpen(false);
      },
    });

    for (const op of ops) {
      cmds.push({
        id: `op-${op.id}`,
        label: op.name,
        hint: `${op.status}${op.publicUrl ? ' · ' + shortHost(op.publicUrl) : ''}`,
        group: 'operation',
        icon: Wrench,
        run: () => {
          setActiveId(op.id);
          setOpen(false);
        },
      });
      if (op.publicUrl) {
        cmds.push({
          id: `op-${op.id}-copy`,
          label: `Copy public URL — ${op.name}`,
          hint: shortHost(op.publicUrl),
          group: 'operation',
          icon: Copy,
          run: async () => {
            try {
              await navigator.clipboard.writeText(op.publicUrl ?? '');
            } catch {
              /* clipboard might be blocked; nbd */
            }
            setOpen(false);
          },
        });
        cmds.push({
          id: `op-${op.id}-open`,
          label: `Open public URL — ${op.name}`,
          hint: shortHost(op.publicUrl),
          group: 'operation',
          icon: ExternalLink,
          run: () => {
            window.open(op.publicUrl ?? '', '_blank', 'noopener,noreferrer');
            setOpen(false);
          },
        });
        cmds.push({
          id: `op-${op.id}-redeploy`,
          label: `Redeploy — ${op.name}`,
          hint: 'Re-runs the build engine + Blaxel deploy',
          group: 'operation',
          icon: Repeat,
          run: async () => {
            setOpen(false);
            try {
              await operations.deploy(op.id);
            } catch {
              /* Workspace surfaces the error via SSE */
            }
          },
        });
      }
    }

    cmds.push({
      id: 'sign-out',
      label: 'Sign out',
      group: 'system',
      icon: LogOut,
      run: async () => {
        await auth.logout();
        setMe(null);
        setView('sign-in');
        setOpen(false);
      },
    });

    return cmds;
  }, [ops, setActiveId, setMe, setView]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.hint && c.hint.toLowerCase().includes(q)),
    );
  }, [commands, query]);

  // Clamp active index when filtered changes.
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[15vh]"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-xl border border-argo-border bg-argo-surface shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 border-b border-argo-border px-4 h-12">
              <Search className="h-4 w-4 text-argo-textSecondary flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const cmd = filtered[activeIndex];
                    if (cmd) void cmd.run();
                  }
                }}
                placeholder="Search operations and commands…"
                className="flex-1 bg-transparent text-argo-text placeholder:text-argo-textSecondary focus:outline-none text-sm"
              />
              <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-argo-border px-1.5 py-0.5 text-[10px] text-argo-textSecondary font-mono">
                Esc
              </kbd>
            </div>

            <div className="max-h-[50vh] overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-argo-textSecondary">
                  No matches. Try a different search.
                </div>
              ) : (
                <ul className="py-1">
                  {filtered.map((cmd, idx) => {
                    const Icon = cmd.icon;
                    const isActive = idx === activeIndex;
                    return (
                      <li
                        key={cmd.id}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => void cmd.run()}
                        className={cn(
                          'flex items-center gap-3 px-4 py-2 text-sm cursor-pointer',
                          isActive ? 'bg-argo-accent/10 text-argo-text' : 'text-argo-textSecondary',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-4 w-4 flex-shrink-0',
                            isActive ? 'text-argo-accent' : 'text-argo-textSecondary',
                          )}
                        />
                        <span className={cn('flex-1 truncate', isActive && 'text-argo-text')}>
                          {cmd.label}
                        </span>
                        {cmd.hint && (
                          <span className="text-xs text-argo-textSecondary font-mono truncate">
                            {cmd.hint}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-argo-border px-4 h-10 text-[11px] text-argo-textSecondary">
              <div className="flex items-center gap-3">
                <span>
                  <kbd className="rounded border border-argo-border px-1 py-0.5 font-mono">↑↓</kbd>{' '}
                  navigate
                </span>
                <span>
                  <kbd className="rounded border border-argo-border px-1 py-0.5 font-mono">↵</kbd>{' '}
                  run
                </span>
              </div>
              <span>{filtered.length} commands</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function shortHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
