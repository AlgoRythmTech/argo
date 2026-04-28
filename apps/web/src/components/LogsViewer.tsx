import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, Loader2, Pause, Play, X } from 'lucide-react';
import { api } from '../api/client.js';
import { cn } from '../lib/utils.js';

type LogEntry = {
  timestamp: string;
  level: string;
  message: string;
  source?: string;
};

interface LogsViewerProps {
  operationId: string;
  onClose?: () => void;
}

export function LogsViewer({ operationId, onClose }: LogsViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await api.get<{ logs: LogEntry[] }>(
        `/api/operations/${operationId}/logs?tail=200`,
      );
      setLogs(res.logs);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setLoading(false);
    }
  }, [operationId]);

  useEffect(() => {
    void fetchLogs();
    // Poll every 5 seconds for new logs.
    const interval = setInterval(() => void fetchLogs(), 5000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filtered = filter
    ? logs.filter(
        (l) =>
          l.message.toLowerCase().includes(filter.toLowerCase()) ||
          l.level.toLowerCase().includes(filter.toLowerCase()),
      )
    : logs;

  return (
    <div className="h-full flex flex-col bg-[#0d0d0e]">
      <header className="flex items-center justify-between border-b border-argo-border px-4 h-12 flex-shrink-0">
        <div className="flex items-center gap-2 text-argo-text">
          <Terminal className="h-4 w-4 text-argo-green" />
          <span className="text-sm font-medium font-mono">Logs</span>
          <span className="text-[10px] font-mono text-argo-textSecondary">
            {filtered.length} lines
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn(
              'text-xs flex items-center gap-1 px-2 py-1 rounded',
              autoScroll ? 'text-argo-green' : 'text-argo-textSecondary',
            )}
            title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
          >
            {autoScroll ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {autoScroll ? 'Live' : 'Paused'}
          </button>
          <button
            type="button"
            onClick={() => { setLogs([]); void fetchLogs(); }}
            className="text-xs text-argo-textSecondary hover:text-argo-text px-2"
          >
            Clear
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="text-argo-textSecondary hover:text-argo-text">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div className="border-b border-argo-border px-3 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter logs…"
          className="w-full bg-transparent text-argo-text text-xs font-mono placeholder:text-argo-textSecondary focus:outline-none"
        />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto font-mono text-[11px] leading-5">
        {loading && (
          <div className="flex items-center justify-center py-16 text-argo-textSecondary">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Connecting…
          </div>
        )}

        {!loading && error && (
          <div className="p-4 text-argo-red text-xs">{error}</div>
        )}

        {!loading && filtered.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Terminal className="h-8 w-8 text-argo-textSecondary mb-3" />
            <p className="text-argo-textSecondary text-sm">No logs yet</p>
            <p className="text-argo-textSecondary text-xs mt-1">
              Deploy your operation to start seeing logs here.
            </p>
          </div>
        )}

        {filtered.map((log, i) => (
          <div
            key={`${log.timestamp}-${i}`}
            className="px-3 py-0.5 hover:bg-white/[0.02] flex gap-2 border-b border-white/[0.03]"
          >
            <span className="text-argo-textSecondary flex-shrink-0 w-20">
              {formatTimestamp(log.timestamp)}
            </span>
            <span
              className={cn(
                'flex-shrink-0 w-12 uppercase',
                log.level === 'error' || log.level === 'fatal'
                  ? 'text-argo-red'
                  : log.level === 'warn'
                  ? 'text-argo-amber'
                  : log.level === 'info'
                  ? 'text-argo-accent'
                  : 'text-argo-textSecondary',
              )}
            >
              {log.level}
            </span>
            <span className="text-argo-text break-all">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts.slice(11, 19);
  }
}
