import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Globe,
  Loader2,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { domains, type CustomDomain } from '../api/client.js';
import { cn } from '../lib/utils.js';

/* ── component ────────────────────────────────────────────────────────── */

export function DomainManager({ operationId }: { operationId: string }) {
  const [domainList, setDomainList] = useState<CustomDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* add form */
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /* dns instructions from a successful add */
  const [dnsInfo, setDnsInfo] = useState<{
    domain: string;
    cnameTarget: string;
    instructions: { step1: string; step2: string; step3: string };
  } | null>(null);

  /* verify / delete busy states */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchDomains = useCallback(async () => {
    try {
      const res = await domains.list(operationId);
      setDomainList(res.domains);
    } catch {
      setDomainList([]);
    } finally {
      setLoading(false);
    }
  }, [operationId]);

  useEffect(() => {
    void fetchDomains();
  }, [fetchDomains]);

  /* ── add domain ─────────────────────────────────────────────────────── */

  const validateDomain = (d: string) =>
    /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(d.trim());

  const handleAdd = async () => {
    const d = newDomain.trim().toLowerCase();
    if (!validateDomain(d)) {
      setAddError('Enter a valid domain (e.g. app.example.com)');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await domains.add(operationId, d);
      setDnsInfo({
        domain: res.domain,
        cnameTarget: res.cnameTarget,
        instructions: res.instructions,
      });
      setNewDomain('');
      setShowAdd(false);
      await fetchDomains();
    } catch (err) {
      setAddError(String((err as Error)?.message ?? err));
    } finally {
      setAdding(false);
    }
  };

  /* ── verify ─────────────────────────────────────────────────────────── */

  const handleVerify = async (domainId: string) => {
    setBusyId(domainId);
    try {
      await domains.verify(operationId, domainId);
      await fetchDomains();
    } catch {
      // silently handled -- status refreshes on next fetch
    } finally {
      setBusyId(null);
    }
  };

  /* ── delete ─────────────────────────────────────────────────────────── */

  const handleDelete = async (domainId: string) => {
    setBusyId(domainId);
    try {
      await domains.remove(operationId, domainId);
      setDomainList((prev) => prev.filter((d) => d.id !== domainId));
      setConfirmDelete(null);
    } catch {
      // handled gracefully
    } finally {
      setBusyId(null);
    }
  };

  /* ── render ─────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-argo-bg">
        <Loader2 className="h-5 w-5 animate-spin text-argo-accent" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-argo-bg p-6 space-y-6 text-argo-text">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-argo-accent" />
          <h2 className="text-lg font-semibold">Custom Domains</h2>
        </div>
        <button
          type="button"
          onClick={() => { setShowAdd(!showAdd); setAddError(null); setDnsInfo(null); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-argo-accent text-argo-bg text-sm font-medium hover:bg-argo-accent/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> Add Domain
        </button>
      </div>

      {/* add domain form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-argo-border bg-argo-surface p-5 space-y-3">
              <label className="text-sm font-medium text-argo-text/70">Domain Name</label>
              <div className="flex gap-2">
                <input
                  value={newDomain}
                  onChange={(e) => { setNewDomain(e.target.value); setAddError(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  placeholder="app.example.com"
                  className="flex-1 bg-argo-bg border border-argo-border rounded-lg px-3 py-2 text-sm text-argo-text placeholder:text-argo-text/30 focus:outline-none focus:border-argo-accent"
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={adding || !newDomain.trim()}
                  className="px-4 py-2 rounded-lg bg-argo-accent text-argo-bg text-sm font-medium hover:bg-argo-accent/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Add
                </button>
              </div>
              {addError && (
                <p className="text-xs text-argo-red flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {addError}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DNS instructions card */}
      <AnimatePresence>
        {dnsInfo && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="rounded-xl border border-argo-accent/30 bg-argo-accent/5 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-argo-accent">DNS Configuration Required</h3>
              <button type="button" onClick={() => setDnsInfo(null)} className="text-argo-text/40 hover:text-argo-text">
                <XCircle className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-argo-text/60">
              Point <span className="font-mono text-argo-text">{dnsInfo.domain}</span> to the CNAME target below:
            </p>
            <div className="flex items-center gap-2 bg-argo-bg rounded-lg px-3 py-2 border border-argo-border">
              <code className="text-sm font-mono text-argo-accent flex-1 break-all">{dnsInfo.cnameTarget}</code>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(dnsInfo.cnameTarget)}
                className="text-argo-text/40 hover:text-argo-text flex-shrink-0"
                title="Copy CNAME"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <ol className="text-xs text-argo-text/60 space-y-1 list-decimal list-inside">
              <li>{dnsInfo.instructions.step1}</li>
              <li>{dnsInfo.instructions.step2}</li>
              <li>{dnsInfo.instructions.step3}</li>
            </ol>
          </motion.div>
        )}
      </AnimatePresence>

      {/* domain list */}
      {domainList.length === 0 && !showAdd ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20 text-center"
        >
          <Globe className="h-10 w-10 text-argo-text/15 mb-4" />
          <p className="text-sm text-argo-text/50">No custom domains configured</p>
          <p className="text-xs text-argo-text/30 mt-1">Click "Add Domain" to connect your own domain.</p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {domainList.map((d, i) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.04 }}
              className="rounded-xl border border-argo-border bg-argo-surface p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <StatusBadge status={d.status} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{d.domain}</div>
                    <div className="text-xs text-argo-text/40 mt-0.5">
                      Added {new Date(d.createdAt).toLocaleDateString()}
                      {d.verifiedAt && ` -- Verified ${new Date(d.verifiedAt).toLocaleDateString()}`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* SSL indicator */}
                  <div className={cn(
                    'flex items-center gap-1 text-xs px-2 py-1 rounded',
                    d.sslStatus === 'active' ? 'text-argo-green bg-argo-green/10' : 'text-argo-text/30 bg-argo-surface',
                  )}>
                    <Lock className="h-3 w-3" />
                    <span>SSL {d.sslStatus}</span>
                  </div>

                  {/* verify button */}
                  {(d.status === 'pending_verification' || d.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => handleVerify(d.id)}
                      disabled={busyId === d.id}
                      className="text-xs text-argo-accent hover:text-argo-accent/80 px-2 py-1 rounded bg-argo-accent/10 disabled:opacity-50 flex items-center gap-1"
                    >
                      {busyId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                      Verify
                    </button>
                  )}

                  {/* delete button */}
                  {confirmDelete === d.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDelete(d.id)}
                        disabled={busyId === d.id}
                        className="text-xs text-argo-red hover:text-argo-red/80 px-2 py-1 rounded bg-argo-red/10 disabled:opacity-50"
                      >
                        {busyId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs text-argo-text/40 hover:text-argo-text px-1"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(d.id)}
                      className="text-argo-text/30 hover:text-argo-red transition-colors p-1"
                      title="Remove domain"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* CNAME row */}
              <div className="mt-3 flex items-center gap-2 text-xs text-argo-text/40">
                <span>CNAME:</span>
                <code className="font-mono text-argo-text/60">{d.cnameTarget}</code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(d.cnameTarget)}
                  className="text-argo-text/30 hover:text-argo-text"
                  title="Copy"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-argo-red">{error}</p>}
    </div>
  );
}

/* ── sub-components ───────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: CustomDomain['status'] }) {
  const config: Record<CustomDomain['status'], { icon: typeof CheckCircle2; color: string; label: string }> = {
    active:               { icon: CheckCircle2, color: 'text-argo-green bg-argo-green/10', label: 'Active' },
    verified:             { icon: CheckCircle2, color: 'text-argo-green bg-argo-green/10', label: 'Verified' },
    pending_verification: { icon: Clock,        color: 'text-argo-amber bg-argo-amber/10', label: 'Pending' },
    failed:               { icon: XCircle,      color: 'text-argo-red bg-argo-red/10',     label: 'Failed' },
    removed:              { icon: XCircle,      color: 'text-argo-text/30 bg-argo-surface', label: 'Removed' },
  };
  const c = config[status] ?? config.pending_verification;
  const Icon = c.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', c.color)}>
      <Icon className="h-3 w-3" />
      {c.label}
    </span>
  );
}
