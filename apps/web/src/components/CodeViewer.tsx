// The Michelin-grade code viewer.
//
// Three-pane layout: file tree (left, 240px) · header bar (path + copy + size)
// · code body with line numbers + Prism syntax highlight. Loaded lazily —
// clicking a file in the tree fetches its contents from the API on demand.
// Copy button drops contents into the clipboard with a soft toast.

import { useEffect, useMemo, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-tsx.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-yaml.js';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  ChevronRight,
  Copy,
  FileCode2,
  Folder,
  Loader2,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { operations, type GeneratedBundle, type GeneratedFileSummary } from '../api/client.js';
import { cn } from '../lib/utils.js';

interface SearchHit {
  path: string;
  argoGenerated: boolean;
  truncated: boolean;
  matches: Array<{ line: number; text: string; before: string | null; after: string | null }>;
}
interface SearchResult {
  query: string;
  matchCount: number;
  fileCount: number;
  truncated: boolean;
  files: SearchHit[];
}

interface CodeViewerProps {
  operationId: string;
  bundle: GeneratedBundle;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  argoGenerated?: boolean;
  children: FileTreeNode[];
}

export function CodeViewer({ operationId, bundle }: CodeViewerProps) {
  const tree = useMemo(() => buildTree(bundle.files), [bundle.files]);
  const [activePath, setActivePath] = useState<string | null>(() => bundle.files[0]?.path ?? null);
  const [contents, setContents] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Debounced bundle search. The endpoint is server-side grep across
  // every file in the latest bundle — auditor-grade "where do we
  // touch credit cards" without downloading the bundle.
  useEffect(() => {
    const q = searchInput.trim();
    if (q.length < 2) {
      setSearchResult(null);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    const handle = setTimeout(() => {
      operations
        .searchBundle(operationId, q)
        .then((res) => {
          if (cancelled) return;
          setSearchResult({
            query: res.query,
            matchCount: res.matchCount,
            fileCount: res.fileCount,
            truncated: res.truncated,
            files: res.files,
          });
          setSearchLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          const msg = String(err?.message ?? err);
          setSearchError(msg.includes('legacy_bundle') ? 'Redeploy this operation to enable search.' : msg.slice(0, 200));
          setSearchLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [operationId, searchInput]);

  const jumpToHit = (path: string) => {
    setActivePath(path);
    // Keep the search query so the user sees the highlight; clear input only on Esc.
  };

  useEffect(() => {
    if (!activePath) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    operations
      .fileContents(operationId, activePath)
      .then((res) => {
        if (cancelled) return;
        setContents(res.contents);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = String(err);
        setError(msg.includes('legacy_bundle') ? 'Redeploy this operation to view contents.' : msg.slice(0, 200));
        setContents(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [operationId, activePath]);

  const activeMeta = bundle.files.find((f) => f.path === activePath) ?? null;
  const language = useMemo(() => detectLanguage(activePath), [activePath]);
  const highlighted = useMemo(() => {
    if (!contents) return '';
    try {
      const grammar = Prism.languages[language] ?? Prism.languages.javascript;
      return Prism.highlight(contents, grammar!, language);
    } catch {
      return escapeHtml(contents);
    }
  }, [contents, language]);
  const lineCount = useMemo(() => (contents ? contents.split('\n').length : 0), [contents]);

  const copy = async () => {
    if (!contents) return;
    try {
      await navigator.clipboard.writeText(contents);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* best-effort */
    }
  };

  const searchActive = searchInput.trim().length >= 2;

  return (
    <div className="h-full flex bg-argo-bg overflow-hidden">
      {/* File tree column */}
      <aside className="w-64 flex-shrink-0 border-r border-argo-border flex flex-col">
        <div className="p-2 border-b border-argo-border/60">
          <div className="flex items-center gap-1.5 bg-argo-surface rounded px-2 h-7">
            <Search className="h-3 w-3 text-argo-textSecondary flex-shrink-0" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearchInput('');
              }}
              placeholder="Search bundle…"
              className="flex-1 min-w-0 bg-transparent text-xs text-argo-text placeholder:text-argo-textSecondary focus:outline-none font-mono"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                title="Clear search (Esc)"
                aria-label="Clear search"
                className="text-argo-textSecondary hover:text-argo-text flex-shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <FileTree node={tree} depth={0} activePath={activePath} onSelect={setActivePath} />
        </div>
      </aside>

      {/* Code pane */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-argo-border px-4 h-10 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileCode2 className="h-3.5 w-3.5 text-argo-textSecondary flex-shrink-0" />
            <span className="font-mono text-xs text-argo-text truncate">{activePath ?? 'select a file'}</span>
            {activeMeta && (
              <span
                title={
                  activeMeta.argoGenerated
                    ? 'argo:generated · auto-editable by repair worker'
                    : 'scaffolding · frozen'
                }
                className={cn(
                  'flex-shrink-0',
                  activeMeta.argoGenerated ? 'text-argo-accent' : 'text-argo-textSecondary',
                )}
              >
                {activeMeta.argoGenerated ? (
                  <ShieldAlert className="h-3 w-3" />
                ) : (
                  <ShieldCheck className="h-3 w-3" />
                )}
              </span>
            )}
            <span className="text-[10px] uppercase tracking-widest text-argo-textSecondary font-mono px-1.5 py-0.5 rounded bg-argo-surface">
              {language}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-argo-textSecondary flex-shrink-0">
            {activeMeta && <span className="font-mono">{prettyBytes(activeMeta.size)}</span>}
            <button
              type="button"
              onClick={copy}
              disabled={!contents}
              title="Copy to clipboard"
              className="inline-flex items-center justify-center h-6 w-6 rounded text-argo-textSecondary hover:text-argo-text hover:bg-argo-surface disabled:opacity-40"
            >
              <AnimatePresence mode="wait">
                {copied ? (
                  <motion.span
                    key="ok"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                  >
                    <Check className="h-3.5 w-3.5 text-argo-green" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="copy"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto bg-[#0a0a0b] font-mono text-[12px] leading-[1.6]">
          {searchActive ? (
            <SearchResultsPanel
              query={searchInput.trim()}
              loading={searchLoading}
              error={searchError}
              result={searchResult}
              onJump={jumpToHit}
              activePath={activePath}
            />
          ) : loading ? (
            <div className="h-full flex items-center justify-center text-argo-textSecondary">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-argo-amber text-xs px-6 text-center">
              {error}
            </div>
          ) : contents ? (
            <div className="flex">
              {/* Line numbers */}
              <div
                className="select-none text-right text-argo-textSecondary/60 pr-3 pl-4 py-3 border-r border-argo-border/60 sticky left-0 bg-[#0a0a0b]"
                style={{ minWidth: 56 }}
                aria-hidden
              >
                {Array.from({ length: lineCount }).map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              {/* Highlighted code */}
              <pre
                className="px-4 py-3 text-argo-text whitespace-pre w-full"
                style={{ tabSize: 2 }}
              >
                <code
                  className={`language-${language}`}
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
              </pre>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-argo-textSecondary text-xs">
              Select a file from the tree.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FileTree({
  node,
  depth,
  activePath,
  onSelect,
}: {
  node: FileTreeNode;
  depth: number;
  activePath: string | null;
  onSelect: (p: string) => void;
}) {
  const [open, setOpen] = useState(true);

  if (node.path === '__root__') {
    return (
      <ul className="space-y-0.5">
        {node.children.map((c) => (
          <li key={c.path}>
            <FileTree node={c} depth={0} activePath={activePath} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    );
  }

  if (node.isDir) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-1 px-2 py-0.5 text-xs text-argo-textSecondary hover:text-argo-text rounded"
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <ChevronRight
            className={cn('h-3 w-3 transition-transform', open && 'rotate-90')}
          />
          <Folder className="h-3 w-3" />
          <span className="font-mono">{node.name}</span>
        </button>
        {open && (
          <ul className="space-y-0.5">
            {node.children.map((c) => (
              <li key={c.path}>
                <FileTree node={c} depth={depth + 1} activePath={activePath} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const isActive = node.path === activePath;
  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className={cn(
        'w-full flex items-center gap-1.5 px-2 py-0.5 text-xs rounded',
        isActive
          ? 'bg-argo-accent/15 text-argo-accent'
          : 'text-argo-textSecondary hover:text-argo-text hover:bg-argo-surface/50',
      )}
      style={{ paddingLeft: 8 + depth * 12 + 12 }}
    >
      <FileCode2 className="h-3 w-3 flex-shrink-0" />
      <span className="font-mono truncate">{node.name}</span>
      {node.argoGenerated && (
        <span className="ml-auto text-[8px] uppercase text-argo-accent/70">gen</span>
      )}
    </button>
  );
}

function SearchResultsPanel({
  query,
  loading,
  error,
  result,
  onJump,
  activePath,
}: {
  query: string;
  loading: boolean;
  error: string | null;
  result: SearchResult | null;
  onJump: (path: string) => void;
  activePath: string | null;
}) {
  if (loading && !result) {
    return (
      <div className="h-full flex items-center justify-center text-argo-textSecondary text-xs">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching for{' '}
        <span className="text-argo-text mx-1">"{query}"</span>…
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-argo-amber text-xs px-6 text-center">
        {error}
      </div>
    );
  }
  if (!result) return null;
  if (result.fileCount === 0) {
    return (
      <div className="h-full flex items-center justify-center text-argo-textSecondary text-xs px-6 text-center">
        No matches for <span className="text-argo-text mx-1">"{query}"</span> in this bundle.
      </div>
    );
  }

  return (
    <div className="px-2 py-3 text-argo-text">
      <div className="px-2 mb-3 text-[11px] uppercase tracking-widest text-argo-textSecondary">
        {result.matchCount} match{result.matchCount === 1 ? '' : 'es'} in {result.fileCount} file
        {result.fileCount === 1 ? '' : 's'}
        {result.truncated && (
          <span className="ml-2 text-argo-amber normal-case tracking-normal">
            (results truncated — narrow the query)
          </span>
        )}
      </div>
      <ul className="space-y-3">
        {result.files.map((f) => (
          <li key={f.path} className="border border-argo-border/60 rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => onJump(f.path)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-argo-surface/40 border-b border-argo-border/40',
                activePath === f.path && 'bg-argo-accent/10',
              )}
            >
              <FileCode2 className="h-3 w-3 text-argo-textSecondary flex-shrink-0" />
              <span className="text-xs text-argo-text font-mono truncate">{f.path}</span>
              <span className="text-[10px] text-argo-textSecondary font-mono ml-auto flex-shrink-0">
                {f.matches.length} match{f.matches.length === 1 ? '' : 'es'}
              </span>
              {f.argoGenerated && (
                <span className="text-[8px] uppercase text-argo-accent/70 flex-shrink-0">gen</span>
              )}
            </button>
            <div className="bg-[#08090b]">
              {f.matches.map((m, i) => (
                <div
                  key={`${f.path}-${m.line}-${i}`}
                  className="px-3 py-1.5 border-b border-argo-border/30 last:border-b-0 text-[11px] leading-[1.5]"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-argo-textSecondary/60 font-mono text-[10px] w-10 text-right flex-shrink-0">
                      {m.line}
                    </span>
                    <span className="text-argo-text font-mono whitespace-pre overflow-hidden">
                      {renderHighlight(m.text, query)}
                    </span>
                  </div>
                  {(m.before || m.after) && (
                    <div className="ml-12 mt-0.5 text-argo-textSecondary/70 font-mono text-[10px] whitespace-pre overflow-hidden">
                      {m.before && <div className="opacity-60">{m.before}</div>}
                      {m.after && <div className="opacity-60">{m.after}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderHighlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const ql = query.toLowerCase();
  const tl = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let from = 0;
  while ((i = tl.indexOf(ql, from)) !== -1) {
    if (i > from) parts.push(text.slice(from, i));
    parts.push(
      <mark
        key={`${i}-${from}`}
        className="bg-argo-accent/25 text-argo-accent rounded-sm px-0.5"
      >
        {text.slice(i, i + query.length)}
      </mark>,
    );
    from = i + query.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

// ── helpers ────────────────────────────────────────────────────────────

function buildTree(files: GeneratedFileSummary[]): FileTreeNode {
  const root: FileTreeNode = { name: '/', path: '__root__', isDir: true, children: [] };
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = f.path.split('/');
    let cursor = root;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      acc = acc ? `${acc}/${name}` : name;
      const isLeaf = i === parts.length - 1;
      let child = cursor.children.find((c) => c.name === name);
      if (!child) {
        child = {
          name,
          path: acc,
          isDir: !isLeaf,
          ...(isLeaf
            ? {
                size: f.size,
                argoGenerated: f.argoGenerated,
              }
            : {}),
          children: [],
        };
        cursor.children.push(child);
      }
      cursor = child;
    }
  }
  // Sort each level: dirs first, then files alphabetically.
  const sortRec = (n: FileTreeNode) => {
    n.children.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

function detectLanguage(path: string | null): string {
  if (!path) return 'javascript';
  const lower = path.toLowerCase();
  if (lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.sh')) return 'bash';
  return 'javascript';
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
