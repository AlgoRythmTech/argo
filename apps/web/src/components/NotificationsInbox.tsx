// In-app notifications inbox. Email is the primary channel (master prompt
// §8); this surface exists for the monthly check-in. Reads from
// /api/notifications, supports search + kind filter, mark-read + mark-all.

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Inbox, Loader2, MailOpen, Search } from 'lucide-react';
import { notifications, type NotificationItem } from '../api/client.js';
import { cn } from '../lib/utils.js';

interface NotificationsInboxProps {
  onClose?: () => void;
}

export function NotificationsInbox({ onClose }: NotificationsInboxProps) {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unreadCount, setUnread] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    notifications
      .list({
        unreadOnly: unreadOnly || undefined,
        ...(q ? { q } : {}),
        ...(kindFilter ? { kind: kindFilter } : {}),
        limit: 200,
      })
      .then((res) => {
        if (cancelled) return;
        setItems(res.notifications);
        setUnread(res.unreadCount);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [unreadOnly, q, kindFilter]);

  const kinds = useMemo(() => {
    if (!items) return [];
    return Array.from(new Set(items.map((i) => i.kind))).sort();
  }, [items]);

  const markRead = async (id: string) => {
    setItems((prev) =>
      prev ? prev.map((i) => (i.id === id ? { ...i, readAt: new Date().toISOString() } : i)) : prev,
    );
    setUnread((u) => Math.max(0, u - 1));
    await notifications.markRead(id).catch(() => undefined);
  };
  const markAllRead = async () => {
    setItems((prev) => (prev ? prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })) : prev));
    setUnread(0);
    await notifications.markAllRead().catch(() => undefined);
  };

  return (
    <div className="h-full flex flex-col bg-argo-bg">
      <header className="flex items-center justify-between border-b border-argo-border px-4 h-12 flex-shrink-0">
        <div className="flex items-center gap-2 text-argo-text">
          <Inbox className="h-4 w-4 text-argo-accent" />
          <span className="text-sm">Notifications</span>
          {unreadCount > 0 && (
            <span className="text-[10px] font-mono uppercase tracking-widest text-argo-accent border border-argo-accent/30 bg-argo-accent/10 rounded px-1.5 py-0.5">
              {unreadCount} new
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-1 text-argo-textSecondary cursor-pointer">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="accent-argo-accent"
            />
            Unread only
          </label>
          <button
            type="button"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="inline-flex items-center gap-1 text-argo-textSecondary hover:text-argo-text disabled:opacity-40"
          >
            <MailOpen className="h-3.5 w-3.5" /> Mark all read
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-argo-textSecondary hover:text-argo-text text-xs px-2"
            >
              Close
            </button>
          )}
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-argo-border px-3 h-10 flex-shrink-0">
        <Search className="h-3.5 w-3.5 text-argo-textSecondary" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search notifications…"
          className="flex-1 bg-transparent text-argo-text text-sm placeholder:text-argo-textSecondary focus:outline-none"
        />
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="bg-argo-surface border border-argo-border rounded text-xs text-argo-text px-2 py-0.5 font-mono"
        >
          <option value="">all kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-argo-textSecondary text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        ) : !items || items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-argo-textSecondary px-12">
            <div className="max-w-sm">
              <CheckCircle2 className="h-6 w-6 mx-auto text-argo-green mb-2" />
              <div className="text-sm argo-body">All clear. Nothing waiting.</div>
            </div>
          </div>
        ) : (
          <ul>
            <AnimatePresence initial={false}>
              {items.map((n) => (
                <motion.li
                  key={n.id}
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  onClick={() => !n.readAt && void markRead(n.id)}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 border-b border-argo-border/60 cursor-pointer transition-colors',
                    n.readAt
                      ? 'bg-transparent hover:bg-argo-surface/30'
                      : 'bg-argo-accent/5 hover:bg-argo-accent/10',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0',
                      n.readAt ? 'bg-argo-textSecondary/30' : 'bg-argo-accent',
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono">
                        {n.kind}
                      </span>
                      {n.operationName && (
                        <span className="text-[10px] text-argo-accent font-mono">· {n.operationName}</span>
                      )}
                      <span className="ml-auto text-[10px] text-argo-textSecondary font-mono">
                        {timeAgo(n.occurredAt)}
                      </span>
                    </div>
                    <div className="text-sm text-argo-text argo-body">{n.message}</div>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
