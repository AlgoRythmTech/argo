import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  File,
  FileCode2,
  FolderArchive,
  Github,
  Key,
  Loader2,
  Send,
} from 'lucide-react';
import { codeExport, type ExportBundle } from '../api/client.js';
import { cn } from '../lib/utils.js';

/* ── component ────────────────────────────────────────────────────────── */

export function CodeExport({
  operationId,
  operationName,
}: {
  operationId: string;
  operationName: string;
}) {
  /* download state */
  const [bundle, setBundle] = useState<ExportBundle | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  /* github push state */
  const [repoName, setRepoName] = useState(slugify(operationName));
  const [githubToken, setGithubToken] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{
    ok: boolean;
    repoUrl: string;
    filesPushed: number;
    errors: string[];
  } | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  /* ── download handler ───────────────────────────────────────────────── */

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await codeExport.download(operationId);
      setBundle(res);

      // trigger browser download as JSON (ZIP-like bundle)
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slugify(operationName)}-v${res.bundleVersion}.argo-export.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(String((err as Error)?.message ?? err));
    } finally {
      setDownloading(false);
    }
  };

  /* ── github push handler ────────────────────────────────────────────── */

  const handlePush = async () => {
    if (!repoName.trim() || !githubToken.trim()) return;
    setPushing(true);
    setPushError(null);
    setPushResult(null);
    try {
      const res = await codeExport.pushToGithub(operationId, {
        repoName: repoName.trim(),
        githubToken: githubToken.trim(),
      });
      setPushResult({
        ok: res.ok,
        repoUrl: res.repoUrl,
        filesPushed: res.filesPushed,
        errors: res.errors,
      });
    } catch (err) {
      setPushError(String((err as Error)?.message ?? err));
    } finally {
      setPushing(false);
    }
  };

  /* ── render ─────────────────────────────────────────────────────────── */

  return (
    <div className="h-full overflow-y-auto bg-argo-bg p-6 space-y-6 text-argo-text">
      {/* header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="flex items-center gap-2 mb-1">
          <FolderArchive className="h-5 w-5 text-argo-accent" />
          <h2 className="text-lg font-semibold">Code Export</h2>
        </div>
        <p className="text-sm text-argo-text/50">
          You own your code. Download the full source or push directly to GitHub.
        </p>
      </motion.div>

      {/* ── download section ──────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.06 }}
        className="rounded-xl border border-argo-border bg-argo-surface p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-argo-accent" />
            <h3 className="text-sm font-medium">Download Code</h3>
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-argo-accent text-argo-bg text-sm font-medium hover:bg-argo-accent/90 disabled:opacity-50 transition-colors"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {downloading ? 'Preparing...' : 'Download Bundle'}
          </button>
        </div>

        {downloadError && (
          <div className="flex items-center gap-2 text-xs text-argo-red bg-argo-red/10 rounded-lg px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{downloadError}</span>
          </div>
        )}

        {/* file list preview */}
        <AnimatePresence>
          {bundle && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="border border-argo-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-argo-bg/60 border-b border-argo-border">
                  <span className="text-xs text-argo-text/50">
                    {bundle.fileCount} files -- v{bundle.bundleVersion} -- {formatBytes(bundle.totalBytes)}
                  </span>
                  <span className="text-[10px] text-argo-text/30 font-mono">{bundle.generatedByModel}</span>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {bundle.files.map((f, i) => (
                    <div
                      key={f.path}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-argo-accent/5 transition-colors',
                        i < bundle.files.length - 1 && 'border-b border-argo-border/30',
                      )}
                    >
                      <FileIcon path={f.path} />
                      <span className="flex-1 truncate font-mono text-argo-text/70">{f.path}</span>
                      <span className="text-argo-text/30 flex-shrink-0">{formatBytes(f.size)}</span>
                      {f.argoGenerated && (
                        <span className="text-[9px] text-argo-accent bg-argo-accent/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
                          generated
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── github push section ───────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.12 }}
        className="rounded-xl border border-argo-border bg-argo-surface p-5 space-y-4"
      >
        <div className="flex items-center gap-2">
          <Github className="h-4 w-4 text-argo-accent" />
          <h3 className="text-sm font-medium">Push to GitHub</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-argo-text/50 flex items-center gap-1">
              <FileCode2 className="h-3 w-3" /> Repository Name
            </label>
            <input
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="my-argo-app"
              className="w-full bg-argo-bg border border-argo-border rounded-lg px-3 py-2 text-sm text-argo-text placeholder:text-argo-text/30 focus:outline-none focus:border-argo-accent"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-argo-text/50 flex items-center gap-1">
              <Key className="h-3 w-3" /> GitHub Personal Access Token
            </label>
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxx"
              className="w-full bg-argo-bg border border-argo-border rounded-lg px-3 py-2 text-sm text-argo-text placeholder:text-argo-text/30 focus:outline-none focus:border-argo-accent"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handlePush}
            disabled={pushing || !repoName.trim() || !githubToken.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-argo-accent text-argo-bg text-sm font-medium hover:bg-argo-accent/90 disabled:opacity-50 transition-colors"
          >
            {pushing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {pushing ? 'Pushing...' : 'Push to GitHub'}
          </button>
          <span className="text-[10px] text-argo-text/30">
            Token needs repo scope. We never store it.
          </span>
        </div>

        {/* progress / pushing state */}
        <AnimatePresence>
          {pushing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 text-sm text-argo-text/60"
            >
              <div className="flex-1 h-1.5 bg-argo-border rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-argo-accent rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: '80%' }}
                  transition={{ duration: 8, ease: 'linear' }}
                />
              </div>
              <span className="text-xs">Pushing files...</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* push error */}
        {pushError && (
          <div className="flex items-center gap-2 text-xs text-argo-red bg-argo-red/10 rounded-lg px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{pushError}</span>
          </div>
        )}

        {/* push success */}
        <AnimatePresence>
          {pushResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={cn(
                'rounded-lg px-4 py-3 text-sm',
                pushResult.ok
                  ? 'bg-argo-green/10 border border-argo-green/20'
                  : 'bg-argo-red/10 border border-argo-red/20',
              )}
            >
              {pushResult.ok ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-argo-green font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Successfully pushed {pushResult.filesPushed} files</span>
                  </div>
                  <a
                    href={pushResult.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-argo-accent hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> {pushResult.repoUrl}
                  </a>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-argo-red font-medium">
                    <AlertCircle className="h-4 w-4" />
                    <span>Push completed with errors</span>
                  </div>
                  {pushResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-argo-red/70 ml-6">{e}</p>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ownership notice */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.2 }}
        className="text-center py-4"
      >
        <p className="text-xs text-argo-text/25">
          Argo generates code. You own it. No vendor lock-in. Export and leave anytime.
        </p>
      </motion.div>
    </div>
  );
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'argo-export';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ path }: { path: string }) {
  const ext = path.split('.').pop()?.toLowerCase();
  const isCode = ['ts', 'tsx', 'js', 'jsx', 'json', 'mjs', 'cjs'].includes(ext ?? '');
  return isCode
    ? <FileCode2 className="h-3.5 w-3.5 text-argo-accent/60 flex-shrink-0" />
    : <File className="h-3.5 w-3.5 text-argo-text/30 flex-shrink-0" />;
}
