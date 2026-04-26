import { useEffect, useState } from 'react';
import { ArrowLeft, Check, X } from 'lucide-react';
import { useArgo } from '../state/store.js';
import { LiquidButton } from '../components/ui/liquid-glass-button.js';
import { repairs } from '../api/client.js';

interface RepairDoc {
  id: string;
  operationId: string;
  failureKind: string;
  status: string;
  whatBroke: string;
  whatChanged: string;
  whatWeTested: string;
  patchedFiles: Array<{ path: string; diffUnified: string; reason: string }>;
  createdAt: string;
  approvedAt: string | null;
}

export function RepairReview() {
  const setView = useArgo((s) => s.setView);
  const [items, setItems] = useState<RepairDoc[]>([]);
  const [active, setActive] = useState<RepairDoc | null>(null);

  useEffect(() => {
    void repairs.list().then((rows) => {
      setItems(rows as unknown as RepairDoc[]);
      if ((rows as unknown[]).length > 0) setActive((rows as unknown as RepairDoc[])[0] ?? null);
    });
  }, []);

  return (
    <div className="argo-desktop-only h-full grid grid-cols-[280px_1fr] bg-argo-bg">
      <aside className="border-r border-argo-border flex flex-col">
        <div className="px-4 py-4 border-b border-argo-border flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('workspace')}
            className="text-argo-textSecondary hover:text-argo-text"
            aria-label="Back to workspace"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="text-argo-text font-semibold">Repairs</div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-sm text-argo-textSecondary text-center">
              No repairs yet. When something breaks, Argo will diagnose, patch, and ask you here.
            </div>
          ) : (
            <ul className="space-y-1">
              {items.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setActive(r)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      active?.id === r.id
                        ? 'bg-argo-accent/10 border border-argo-accent/30 text-argo-text'
                        : 'hover:bg-argo-surface text-argo-textSecondary'
                    }`}
                  >
                    <div className="font-medium truncate">{r.whatBroke}</div>
                    <div className="text-[11px] font-mono mt-0.5 capitalize">
                      {r.status.replace(/_/g, ' ')}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <main className="overflow-y-auto p-8">
        {!active ? (
          <div className="text-center text-argo-textSecondary mt-24">
            Pick a repair on the left to review.
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            <div className="text-xs font-mono uppercase tracking-widest text-argo-textSecondary mb-2">
              Repair · {new Date(active.createdAt).toLocaleString()}
            </div>
            <h1 className="text-3xl font-bold text-argo-text mb-6">{active.whatBroke}</h1>

            <div className="grid grid-cols-3 gap-3 mb-8">
              <Stat label="What broke" value={active.whatBroke} tone="red" />
              <Stat label="What changed" value={active.whatChanged} tone="cyan" />
              <Stat label="What we tested" value={active.whatWeTested} tone="green" />
            </div>

            <div className="rounded-lg border border-argo-border bg-argo-surface p-6 mb-8">
              <h2 className="text-sm font-mono uppercase tracking-widest text-argo-textSecondary mb-3">
                Plain-English summary
              </h2>
              <p className="text-argo-text leading-relaxed">{active.whatChanged}</p>
            </div>

            <div className="rounded-lg border border-argo-border bg-argo-surface p-6 mb-8">
              <h2 className="text-sm font-mono uppercase tracking-widest text-argo-textSecondary mb-3">
                Files touched
              </h2>
              <ul className="space-y-2">
                {active.patchedFiles.map((f, idx) => (
                  <li key={`${f.path}-${idx}`} className="text-sm">
                    <div className="font-mono text-argo-accent">{f.path}</div>
                    <div className="text-argo-textSecondary text-xs mt-0.5">{f.reason}</div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-argo-border px-4 py-2 text-sm text-argo-textSecondary hover:text-argo-text"
              >
                <X className="h-4 w-4" /> Reject and roll back
              </button>
              <LiquidButton
                size="lg"
                className="bg-argo-accent text-argo-bg font-semibold rounded-md inline-flex items-center gap-2"
              >
                <Check className="h-4 w-4" /> Approve repair
              </LiquidButton>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'red' | 'cyan' | 'green' }) {
  const toneClass =
    tone === 'red' ? 'text-argo-red' : tone === 'green' ? 'text-argo-green' : 'text-argo-accent';
  return (
    <div className="rounded-lg border border-argo-border bg-argo-surface p-4">
      <div className={`text-[11px] font-mono uppercase tracking-widest ${toneClass}`}>{label}</div>
      <div className="text-sm text-argo-text mt-2 leading-snug">{value}</div>
    </div>
  );
}
