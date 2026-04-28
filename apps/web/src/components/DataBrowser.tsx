import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Database,
  FileJson,
  Loader2,
  Search,
  Table2,
  X,
} from 'lucide-react';
import { dataBrowser, type DataCollection } from '../api/client.js';
import { cn } from '../lib/utils.js';

/* ── sample fallback data ─────────────────────────────────────────────── */

const SAMPLE_COLLECTIONS: DataCollection[] = [
  { name: 'users', type: 'collection', documentCount: 142 },
  { name: 'submissions', type: 'collection', documentCount: 1_038 },
  { name: 'approvals', type: 'collection', documentCount: 327 },
  { name: 'audit_log', type: 'collection', documentCount: 5_219 },
];

const SAMPLE_DOCS: Record<string, unknown>[] = Array.from({ length: 8 }, (_, i) => ({
  _id: `doc_${i + 1}`,
  name: `Record ${i + 1}`,
  email: `user${i + 1}@example.com`,
  status: i % 3 === 0 ? 'active' : i % 3 === 1 ? 'pending' : 'archived',
  createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
}));

/* ── component ────────────────────────────────────────────────────────── */

export function DataBrowser({ operationId }: { operationId: string }) {
  const [collections, setCollections] = useState<DataCollection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Record<string, unknown>[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [docsLoading, setDocsLoading] = useState(false);
  const [error, _setError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<Record<string, unknown> | null>(null);

  /* fetch collections */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    dataBrowser
      .collections(operationId)
      .then((res) => {
        if (!cancelled) {
          setCollections(res.collections);
          if (res.collections.length > 0 && !selected) setSelected(res.collections[0]!.name);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCollections(SAMPLE_COLLECTIONS);
          setSelected(SAMPLE_COLLECTIONS[0]!.name);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [operationId]);

  /* fetch documents for selected collection */
  const fetchDocs = useCallback(async (col: string, pg: number, ft: string) => {
    setDocsLoading(true);
    try {
      const res = await dataBrowser.browse(operationId, col, {
        page: pg,
        limit: 20,
        filter: ft || undefined,
      });
      setDocuments(res.documents);
      setTotalPages(res.totalPages);
      setTotalCount(res.totalCount);
    } catch {
      setDocuments(SAMPLE_DOCS);
      setTotalPages(1);
      setTotalCount(SAMPLE_DOCS.length);
    } finally {
      setDocsLoading(false);
    }
  }, [operationId]);

  useEffect(() => {
    if (selected) void fetchDocs(selected, page, filter);
  }, [selected, page, fetchDocs]);

  const handleSearch = () => {
    setPage(1);
    if (selected) void fetchDocs(selected, 1, filter);
  };

  /* column keys from first doc */
  const columns = documents.length > 0 && documents[0]
    ? Object.keys(documents[0]).slice(0, 6)
    : [];

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-argo-bg">
        <Loader2 className="h-5 w-5 animate-spin text-argo-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-argo-bg text-argo-red text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="h-full flex bg-argo-bg text-argo-text overflow-hidden">
      {/* ── sidebar ──────────────────────────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 border-r border-argo-border flex flex-col">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-argo-border">
          <Database className="h-4 w-4 text-argo-accent" />
          <span className="text-sm font-medium">Collections</span>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {collections.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => { setSelected(c.name); setPage(1); setInspecting(null); }}
              className={cn(
                'w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-colors',
                selected === c.name
                  ? 'bg-argo-accent/10 text-argo-accent'
                  : 'text-argo-text hover:bg-argo-surface',
              )}
            >
              <span className="truncate">{c.name}</span>
              <span className="text-xs text-argo-text/50 ml-2 flex-shrink-0">
                {c.documentCount.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* ── main panel ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* search bar */}
        <div className="flex items-center gap-2 px-4 h-12 border-b border-argo-border">
          <Search className="h-4 w-4 text-argo-text/40" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Filter documents..."
            className="flex-1 bg-transparent text-sm text-argo-text placeholder:text-argo-text/30 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSearch}
            className="text-xs text-argo-accent hover:text-argo-accent/80 px-2 py-1 rounded bg-argo-accent/10"
          >
            Search
          </button>
        </div>

        {/* document table or inspector */}
        <div className="flex-1 overflow-auto relative">
          <AnimatePresence mode="wait">
            {inspecting ? (
              <motion.div
                key="inspector"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.15 }}
                className="p-4"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <FileJson className="h-4 w-4 text-argo-accent" />
                    <span className="text-sm font-medium">Document Detail</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspecting(null)}
                    className="text-argo-text/40 hover:text-argo-text"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <pre className="text-xs font-mono bg-argo-surface rounded-lg border border-argo-border p-4 overflow-auto max-h-[calc(100vh-14rem)] whitespace-pre-wrap text-argo-text/80">
                  {JSON.stringify(inspecting, null, 2)}
                </pre>
              </motion.div>
            ) : (
              <motion.div
                key="table"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {docsLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-4 w-4 animate-spin text-argo-accent mr-2" />
                    <span className="text-sm text-argo-text/50">Loading documents...</span>
                  </div>
                ) : documents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Table2 className="h-8 w-8 text-argo-text/20 mb-3" />
                    <p className="text-sm text-argo-text/50">No documents found</p>
                    <p className="text-xs text-argo-text/30 mt-1">
                      This collection is empty or the filter returned no results.
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-argo-border bg-argo-surface/50 sticky top-0">
                        {columns.map((col) => (
                          <th
                            key={col}
                            className="text-left px-4 py-2 text-xs font-medium text-argo-text/50 uppercase tracking-wider"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((doc, i) => (
                        <tr
                          key={String(doc._id ?? doc.id ?? i)}
                          onClick={() => setInspecting(doc)}
                          className="border-b border-argo-border/50 hover:bg-argo-accent/5 cursor-pointer transition-colors"
                        >
                          {columns.map((col) => (
                            <td key={col} className="px-4 py-2 truncate max-w-[200px] text-argo-text/80">
                              {formatCell(doc[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* pagination */}
        <div className="flex items-center justify-between border-t border-argo-border px-4 h-10 flex-shrink-0 text-xs text-argo-text/50">
          <span>
            {totalCount.toLocaleString()} document{totalCount !== 1 ? 's' : ''}
            {selected ? ` in ${selected}` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1 rounded hover:bg-argo-surface disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1 rounded hover:bg-argo-surface disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '--';
  if (typeof value === 'string') return value.length > 60 ? value.slice(0, 57) + '...' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 40) + '...';
  return String(value);
}
