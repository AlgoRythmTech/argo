import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Loader2, MessageCircle, Send, X } from 'lucide-react';
import { chat, type ChatMessage } from '../api/client.js';
import { cn } from '../lib/utils.js';

interface ChatPanelProps {
  operationId?: string;
  onClose?: () => void;
}

export function ChatPanel({ operationId, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setError(null);
    setSending(true);

    // Optimistically add user message.
    const userMsg: ChatMessage = {
      id: `local_${Date.now()}`,
      role: 'user',
      content: text,
      model: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const result = await chat.send({
        message: text,
        operationId,
        threadId: threadId ?? undefined,
      });

      setThreadId(result.threadId);

      const assistantMsg: ChatMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: result.response,
        model: result.model,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(String((err as Error)?.message ?? err).slice(0, 200));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending, operationId, threadId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className="h-full flex flex-col bg-argo-bg">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-argo-border px-4 h-12 flex-shrink-0">
        <div className="flex items-center gap-2 text-argo-text">
          <MessageCircle className="h-4 w-4 text-argo-accent" />
          <span className="text-sm font-medium">Ask Argo</span>
          {threadId && (
            <span className="text-[10px] font-mono text-argo-textSecondary">
              {messages.length} messages
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {threadId && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setThreadId(null);
                setError(null);
              }}
              className="text-[10px] font-mono text-argo-textSecondary hover:text-argo-text px-2"
            >
              New thread
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-argo-textSecondary hover:text-argo-text"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="h-10 w-10 text-argo-accent/40 mb-3" />
            <h3 className="text-argo-text text-base mb-1">Chat with Argo</h3>
            <p className="text-argo-textSecondary text-sm max-w-xs">
              Ask questions about your operations, debug issues, or brainstorm workflow ideas.
            </p>
            <div className="mt-6 space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setInput(s);
                    inputRef.current?.focus();
                  }}
                  className="block w-full text-left text-xs text-argo-textSecondary hover:text-argo-text border border-argo-border rounded-lg px-3 py-2 hover:bg-argo-surface transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              className={cn(
                'flex gap-3',
                msg.role === 'user' ? 'justify-end' : 'justify-start',
              )}
            >
              {msg.role === 'assistant' && (
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-argo-accent/15 flex items-center justify-center mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-argo-accent" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-argo-accent text-argo-bg rounded-br-md'
                    : 'bg-argo-surface border border-argo-border text-argo-text rounded-bl-md',
                )}
              >
                <MessageContent content={msg.content} />
                {msg.role === 'assistant' && msg.model && (
                  <div className="mt-1.5 text-[10px] font-mono text-argo-textSecondary opacity-60">
                    {msg.model}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {sending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-3"
          >
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-argo-accent/15 flex items-center justify-center">
              <Loader2 className="h-3.5 w-3.5 text-argo-accent animate-spin" />
            </div>
            <div className="bg-argo-surface border border-argo-border rounded-2xl rounded-bl-md px-4 py-2.5">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-argo-textSecondary animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-argo-textSecondary animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-argo-textSecondary animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="border-t border-argo-red/30 bg-argo-red/10 px-4 py-2 text-xs text-argo-red font-mono">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-argo-border p-3">
        <div className="flex items-end gap-2 bg-argo-surface border border-argo-border rounded-xl px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Argo anything…"
            rows={1}
            className="flex-1 bg-transparent text-argo-text text-sm placeholder:text-argo-textSecondary focus:outline-none resize-none max-h-32"
            style={{ minHeight: '24px' }}
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!input.trim() || sending}
            className={cn(
              'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
              input.trim() && !sending
                ? 'bg-argo-accent text-argo-bg hover:bg-argo-accent/90'
                : 'bg-argo-border text-argo-textSecondary cursor-not-allowed',
            )}
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <div className="text-[10px] text-argo-textSecondary mt-1.5 px-1">
          Enter to send. Shift+Enter for new line.
        </div>
      </div>
    </div>
  );
}

/** Renders markdown-lite content: code blocks, bold, links. */
function MessageContent({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3).replace(/^\w+\n/, '');
          return (
            <pre key={i} className="mt-2 mb-1 bg-argo-bg rounded-lg px-3 py-2 text-xs font-mono overflow-x-auto border border-argo-border">
              <code>{code}</code>
            </pre>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className="bg-argo-bg rounded px-1 py-0.5 text-xs font-mono text-argo-accent">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

const SUGGESTIONS = [
  'How does my operation handle form submissions?',
  'Why are there errors in the last 24 hours?',
  'What would it take to add Slack notifications?',
  'Explain the approval flow step by step',
];
