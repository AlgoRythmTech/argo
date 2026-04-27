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
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { operations, type GeneratedBundle, type GeneratedFileSummary } from '../api/client.js';
import { cn } from '../lib/utils.js';

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

  return (
    <div className="h-full flex bg-argo-bg overflow-hidden">
      {/* File tree */}
      <aside className="w-64 flex-shrink-0 border-r border-argo-border overflow-y-auto py-2">
        <FileTree node={tree} depth={0} activePath={activePath} onSelect={setActivePath} />
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
          {loading ? (
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
