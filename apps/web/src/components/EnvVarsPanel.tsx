import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Key, Loader2, Plus, Trash2, X } from 'lucide-react';
import { api } from '../api/client.js';
import { cn } from '../lib/utils.js';

type EnvVar = { key: string; maskedValue: string; createdAt: string; updatedAt: string };

interface EnvVarsPanelProps {
  operationId: string;
  onClose?: () => void;
}

export function EnvVarsPanel({ operationId, onClose }: EnvVarsPanelProps) {
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const fetchVars = useCallback(async () => {
    try {
      const res = await api.get<{ vars: EnvVar[] }>(`/api/operations/${operationId}/env`);
      setVars(res.vars);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setLoading(false);
    }
  }, [operationId]);

  useEffect(() => { void fetchVars(); }, [fetchVars]);

  const addVar = async () => {
    if (!newKey.trim() || !newValue.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/operations/${operationId}/env`, { key: newKey.trim(), value: newValue.trim() });
      setNewKey('');
      setNewValue('');
      setShowAdd(false);
      await fetchVars();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setSaving(false);
    }
  };

  const deleteVar = async (key: string) => {
    setDeletingKey(key);
    try {
      await api.del(`/api/operations/${operationId}/env/${encodeURIComponent(key)}`);
      setVars((prev) => prev.filter((v) => v.key !== key));
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-argo-bg">
      <header className="flex items-center justify-between border-b border-argo-border px-4 h-12 flex-shrink-0">
        <div className="flex items-center gap-2 text-argo-text">
          <Key className="h-4 w-4 text-argo-accent" />
          <span className="text-sm font-medium">Environment Variables</span>
          <span className="text-[10px] font-mono text-argo-textSecondary">{vars.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-xs text-argo-accent hover:text-argo-accent/80 flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="text-argo-textSecondary hover:text-argo-text">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="border-b border-argo-red/30 bg-argo-red/10 px-4 py-2 text-xs text-argo-red font-mono">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="border-b border-argo-border p-4 bg-argo-surface/50">
          <div className="space-y-2">
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
              placeholder="KEY_NAME"
              className="w-full bg-argo-bg border border-argo-border rounded-md px-3 py-1.5 text-sm text-argo-text font-mono placeholder:text-argo-textSecondary focus:outline-none focus:border-argo-accent"
              autoFocus
            />
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="value"
              type="password"
              className="w-full bg-argo-bg border border-argo-border rounded-md px-3 py-1.5 text-sm text-argo-text font-mono placeholder:text-argo-textSecondary focus:outline-none focus:border-argo-accent"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setShowAdd(false); setNewKey(''); setNewValue(''); }}
                className="text-xs text-argo-textSecondary hover:text-argo-text px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void addVar()}
                disabled={!newKey.trim() || !newValue.trim() || saving}
                className={cn(
                  'text-xs font-semibold px-3 py-1.5 rounded-md transition-colors',
                  newKey.trim() && newValue.trim() && !saving
                    ? 'bg-argo-accent text-argo-bg hover:bg-argo-accent/90'
                    : 'bg-argo-border text-argo-textSecondary cursor-not-allowed',
                )}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-16 text-argo-textSecondary">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        )}

        {!loading && vars.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
            <Key className="h-8 w-8 text-argo-textSecondary mb-3" />
            <h3 className="text-argo-text text-base mb-1">No environment variables</h3>
            <p className="text-argo-textSecondary text-sm max-w-xs">
              Add secrets and config values that your operation needs at runtime. They're injected securely into the sandbox.
            </p>
          </div>
        )}

        {!loading && vars.length > 0 && (
          <ul className="divide-y divide-argo-border">
            <AnimatePresence initial={false}>
              {vars.map((v) => (
                <motion.li
                  key={v.key}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-4 py-3 hover:bg-argo-surface/50 group flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-argo-text font-mono">{v.key}</div>
                    <div className="text-xs text-argo-textSecondary font-mono mt-0.5">{v.maskedValue}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteVar(v.key)}
                    disabled={deletingKey === v.key}
                    className="text-argo-textSecondary hover:text-argo-red opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove"
                  >
                    {deletingKey === v.key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <footer className="border-t border-argo-border px-4 py-2 text-[10px] text-argo-textSecondary font-mono">
        Variables are injected at deploy time. Redeploy to apply changes.
      </footer>
    </div>
  );
}
