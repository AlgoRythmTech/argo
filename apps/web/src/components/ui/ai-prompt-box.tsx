// argo:upstream 21st.dev@ai-prompt-box
// The chat input on the Workspace screen. Handles drag-and-drop voice corpus
// uploads, paste-image previews, and three modal toggles (Search · Think · Canvas)
// that prefix the user's message with structured intent the API parses.
import React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ArrowUp,
  Paperclip,
  Square,
  X,
  StopCircle,
  Mic,
  Globe,
  BrainCog,
  FolderCode,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils.js';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex w-full rounded-md border-none bg-transparent px-3 py-2.5 text-base text-argo-text placeholder:text-argo-textSecondary focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] resize-none',
        className,
      )}
      ref={ref}
      rows={1}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-50 overflow-hidden rounded-md border border-argo-border bg-argo-surfaceAlt px-3 py-1.5 text-sm text-argo-text shadow-md',
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-black/60 backdrop-blur-sm', className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 grid w-full max-w-[90vw] md:max-w-[800px] -translate-x-1/2 -translate-y-1/2 gap-4 border border-argo-border bg-argo-surfaceAlt p-0 shadow-xl rounded-2xl',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 z-10 rounded-full bg-argo-border/60 p-2 hover:bg-argo-border transition-all">
        <X className="h-5 w-5 text-argo-text" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight text-argo-text', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}
const InlineButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const variantClasses = {
      default: 'bg-argo-text hover:bg-argo-text/90 text-argo-bg',
      outline: 'border border-argo-border bg-transparent hover:bg-argo-surfaceAlt',
      ghost: 'bg-transparent hover:bg-argo-surfaceAlt',
    };
    const sizeClasses = {
      default: 'h-10 px-4 py-2',
      sm: 'h-8 px-3 text-sm',
      lg: 'h-12 px-6',
      icon: 'h-8 w-8 rounded-full aspect-square',
    };
    return (
      <button
        className={cn(
          'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
InlineButton.displayName = 'InlineButton';

interface VoiceRecorderProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: (duration: number) => void;
  visualizerBars?: number;
}
const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  isRecording,
  onStartRecording,
  onStopRecording,
  visualizerBars = 32,
}) => {
  const [time, setTime] = React.useState(0);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    if (isRecording) {
      onStartRecording();
      timerRef.current = setInterval(() => setTime((t) => t + 1), 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      onStopRecording(time);
      setTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center w-full transition-all duration-300 py-3',
        isRecording ? 'opacity-100' : 'opacity-0 h-0',
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-argo-red animate-pulse" />
        <span className="font-mono text-sm text-argo-text/80">{formatTime(time)}</span>
      </div>
      <div className="w-full h-10 flex items-center justify-center gap-0.5 px-4">
        {[...Array(visualizerBars)].map((_, i) => (
          <div
            key={i}
            className="w-0.5 rounded-full bg-argo-text/50 animate-pulse"
            style={{
              height: `${Math.max(15, Math.random() * 100)}%`,
              animationDelay: `${i * 0.05}s`,
              animationDuration: `${0.5 + Math.random() * 0.5}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
};

interface PromptInputContextType {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit?: () => void;
  disabled?: boolean;
}
const PromptInputContext = React.createContext<PromptInputContextType>({
  isLoading: false,
  value: '',
  setValue: () => {},
  maxHeight: 240,
  onSubmit: undefined,
  disabled: false,
});
function usePromptInput() {
  const ctx = React.useContext(PromptInputContext);
  if (!ctx) throw new Error('usePromptInput must be used within a PromptInput');
  return ctx;
}

interface PromptInputProps {
  isLoading?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  maxHeight?: number | string;
  onSubmit?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}
const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(
  (
    {
      className,
      isLoading = false,
      maxHeight = 240,
      value,
      onValueChange,
      onSubmit,
      children,
      disabled = false,
      onDragOver,
      onDragLeave,
      onDrop,
    },
    ref,
  ) => {
    const [internalValue, setInternalValue] = React.useState(value ?? '');
    const handleChange = (newValue: string) => {
      setInternalValue(newValue);
      onValueChange?.(newValue);
    };
    return (
      <TooltipProvider>
        <PromptInputContext.Provider
          value={{
            isLoading,
            value: value ?? internalValue,
            setValue: onValueChange ?? handleChange,
            maxHeight,
            onSubmit,
            disabled,
          }}
        >
          <div
            ref={ref}
            className={cn(
              'rounded-3xl border border-argo-border bg-argo-surfaceAlt p-2 shadow-[0_8px_30px_rgba(0,0,0,0.32)] transition-all duration-300',
              isLoading && 'border-argo-red/70',
              className,
            )}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {children}
          </div>
        </PromptInputContext.Provider>
      </TooltipProvider>
    );
  },
);
PromptInput.displayName = 'PromptInput';

interface PromptInputTextareaProps {
  disableAutosize?: boolean;
  placeholder?: string;
}
const PromptInputTextarea: React.FC<
  PromptInputTextareaProps & React.ComponentProps<typeof Textarea>
> = ({ className, onKeyDown, disableAutosize = false, placeholder, ...props }) => {
  const { value, setValue, maxHeight, onSubmit, disabled } = usePromptInput();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (disableAutosize || !textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height =
      typeof maxHeight === 'number'
        ? `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`
        : `min(${textareaRef.current.scrollHeight}px, ${maxHeight})`;
  }, [value, maxHeight, disableAutosize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
    onKeyDown?.(e);
  };

  return (
    <Textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className={cn('text-base', className)}
      disabled={disabled}
      placeholder={placeholder}
      {...props}
    />
  );
};

const PromptInputActions: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className,
  ...props
}) => (
  <div className={cn('flex items-center gap-2', className)} {...props}>
    {children}
  </div>
);

interface PromptInputActionProps extends React.ComponentProps<typeof Tooltip> {
  tooltip: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}
const PromptInputAction: React.FC<PromptInputActionProps> = ({
  tooltip,
  children,
  className,
  side = 'top',
  ...props
}) => {
  const { disabled } = usePromptInput();
  return (
    <Tooltip {...props}>
      <TooltipTrigger asChild disabled={disabled}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
};

const CustomDivider: React.FC = () => (
  <div className="relative h-6 w-[1.5px] mx-1">
    <div className="absolute inset-0 bg-gradient-to-t from-transparent via-argo-accent/70 to-transparent rounded-full" />
  </div>
);

interface ImageViewDialogProps {
  imageUrl: string | null;
  onClose: () => void;
}
const ImageViewDialog: React.FC<ImageViewDialogProps> = ({ imageUrl, onClose }) => {
  if (!imageUrl) return null;
  return (
    <Dialog open={!!imageUrl} onOpenChange={onClose}>
      <DialogContent className="p-0 border-none bg-transparent shadow-none max-w-[90vw] md:max-w-[800px]">
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        <div className="relative bg-argo-surfaceAlt rounded-2xl overflow-hidden shadow-2xl">
          <img src={imageUrl} alt="Preview" className="w-full max-h-[80vh] object-contain" />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export type PromptMode = 'default' | 'search' | 'think' | 'canvas';

export interface PromptInputBoxProps {
  onSend?: (message: string, files: File[], mode: PromptMode) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
}

export const PromptInputBox = React.forwardRef<HTMLDivElement, PromptInputBoxProps>((props, ref) => {
  const {
    onSend = () => {},
    isLoading = false,
    placeholder = 'Describe a workflow Argo should run for you…',
    className,
  } = props;

  const [input, setInput] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [filePreviews, setFilePreviews] = React.useState<Record<string, string>>({});
  const [selectedImage, setSelectedImage] = React.useState<string | null>(null);
  const [isRecording, setIsRecording] = React.useState(false);
  const [mode, setMode] = React.useState<PromptMode>('default');
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const promptBoxRef = React.useRef<HTMLDivElement>(null);

  const setExclusiveMode = (next: PromptMode) =>
    setMode((cur) => (cur === next ? 'default' : next));

  const isImageFile = (file: File) => file.type.startsWith('image/');

  const processFile = (file: File) => {
    if (file.size > 10 * 1024 * 1024) return;
    setFiles((cur) => [...cur, file]);
    if (isImageFile(file)) {
      const reader = new FileReader();
      reader.onload = (e) =>
        setFilePreviews((cur) => ({ ...cur, [file.name]: String(e.target?.result ?? '') }));
      reader.readAsDataURL(file);
    }
  };

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const handleDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const dropped = Array.from(e.dataTransfer.files);
    for (const f of dropped) processFile(f);
  }, []);

  const handleRemoveFile = (index: number) => {
    const target = files[index];
    if (target && filePreviews[target.name]) {
      const next = { ...filePreviews };
      delete next[target.name];
      setFilePreviews(next);
    }
    setFiles((cur) => cur.filter((_, i) => i !== index));
  };

  const openImageModal = (imageUrl: string) => setSelectedImage(imageUrl);

  const handlePaste = React.useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && it.type.indexOf('image') !== -1) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          processFile(f);
          break;
        }
      }
    }
  }, []);

  React.useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed && files.length === 0) return;
    onSend(trimmed, files, mode);
    setInput('');
    setFiles([]);
    setFilePreviews({});
  };

  const handleStopRecording = (duration: number) => {
    setIsRecording(false);
    if (duration > 0) onSend(`[Voice message — ${duration}s]`, [], mode);
  };

  const hasContent = input.trim().length > 0 || files.length > 0;

  return (
    <>
      <PromptInput
        value={input}
        onValueChange={setInput}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        className={cn(
          'w-full bg-argo-surfaceAlt border-argo-border transition-all duration-300 ease-in-out',
          isRecording && 'border-argo-red/70',
          className,
        )}
        disabled={isLoading || isRecording}
        ref={ref ?? promptBoxRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {files.length > 0 && !isRecording && (
          <div className="flex flex-wrap gap-2 p-0 pb-1">
            {files.map((file, index) => (
              <div key={`${file.name}-${index}`} className="relative group">
                {file.type.startsWith('image/') && filePreviews[file.name] ? (
                  <div
                    className="w-16 h-16 rounded-xl overflow-hidden cursor-pointer"
                    onClick={() => openImageModal(filePreviews[file.name]!)}
                  >
                    <img
                      src={filePreviews[file.name]}
                      alt={file.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile(index);
                      }}
                      className="absolute top-1 right-1 rounded-full bg-black/70 p-0.5 transition-opacity"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-argo-border bg-argo-surface px-2 py-1 text-xs text-argo-textSecondary">
                    <Paperclip className="h-3 w-3" />
                    <span className="max-w-[140px] truncate">{file.name}</span>
                    <button
                      onClick={() => handleRemoveFile(index)}
                      className="ml-1 rounded-full hover:bg-argo-border/60"
                      aria-label="Remove file"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div
          className={cn(
            'transition-all duration-300',
            isRecording ? 'h-0 overflow-hidden opacity-0' : 'opacity-100',
          )}
        >
          <PromptInputTextarea
            placeholder={
              mode === 'search'
                ? 'Search recent operations…'
                : mode === 'think'
                ? 'Think through this carefully…'
                : mode === 'canvas'
                ? 'Sketch a workflow on canvas…'
                : placeholder
            }
            className="text-base"
          />
        </div>

        {isRecording && (
          <VoiceRecorder
            isRecording={isRecording}
            onStartRecording={() => undefined}
            onStopRecording={handleStopRecording}
          />
        )}

        <PromptInputActions className="flex items-center justify-between gap-2 p-0 pt-2">
          <div
            className={cn(
              'flex items-center gap-1 transition-opacity duration-300',
              isRecording ? 'opacity-0 invisible h-0' : 'opacity-100 visible',
            )}
          >
            <PromptInputAction tooltip="Attach voice corpus / file">
              <button
                onClick={() => uploadInputRef.current?.click()}
                className="flex h-8 w-8 text-argo-textSecondary cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-argo-surface hover:text-argo-text"
                disabled={isRecording}
                type="button"
                aria-label="Attach file"
              >
                <Paperclip className="h-5 w-5" />
                <input
                  ref={uploadInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      for (const f of Array.from(e.target.files)) processFile(f);
                    }
                    e.target.value = '';
                  }}
                />
              </button>
            </PromptInputAction>

            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setExclusiveMode('search')}
                className={cn(
                  'rounded-full transition-all flex items-center gap-1 px-2 py-1 border h-8',
                  mode === 'search'
                    ? 'bg-argo-accent/15 border-argo-accent text-argo-accent'
                    : 'bg-transparent border-transparent text-argo-textSecondary hover:text-argo-text',
                )}
              >
                <Globe className={cn('w-4 h-4', mode === 'search' ? 'text-argo-accent' : '')} />
                <AnimatePresence>
                  {mode === 'search' && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 'auto', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-xs overflow-hidden whitespace-nowrap text-argo-accent"
                    >
                      Search
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
              <CustomDivider />
              <button
                type="button"
                onClick={() => setExclusiveMode('think')}
                className={cn(
                  'rounded-full transition-all flex items-center gap-1 px-2 py-1 border h-8',
                  mode === 'think'
                    ? 'bg-[#8B5CF6]/15 border-[#8B5CF6] text-[#8B5CF6]'
                    : 'bg-transparent border-transparent text-argo-textSecondary hover:text-argo-text',
                )}
              >
                <BrainCog className={cn('w-4 h-4', mode === 'think' ? 'text-[#8B5CF6]' : '')} />
                <AnimatePresence>
                  {mode === 'think' && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 'auto', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-xs overflow-hidden whitespace-nowrap text-[#8B5CF6]"
                    >
                      Think
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
              <CustomDivider />
              <button
                type="button"
                onClick={() => setExclusiveMode('canvas')}
                className={cn(
                  'rounded-full transition-all flex items-center gap-1 px-2 py-1 border h-8',
                  mode === 'canvas'
                    ? 'bg-argo-amber/15 border-argo-amber text-argo-amber'
                    : 'bg-transparent border-transparent text-argo-textSecondary hover:text-argo-text',
                )}
              >
                <FolderCode className={cn('w-4 h-4', mode === 'canvas' ? 'text-argo-amber' : '')} />
                <AnimatePresence>
                  {mode === 'canvas' && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 'auto', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-xs overflow-hidden whitespace-nowrap text-argo-amber"
                    >
                      Canvas
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            </div>
          </div>

          <PromptInputAction
            tooltip={
              isLoading
                ? 'Stop generation'
                : isRecording
                ? 'Stop recording'
                : hasContent
                ? 'Send message'
                : 'Voice message'
            }
          >
            <InlineButton
              variant="default"
              size="icon"
              className={cn(
                'h-8 w-8 rounded-full transition-all duration-200',
                isRecording
                  ? 'bg-transparent hover:bg-argo-surface text-argo-red'
                  : hasContent
                  ? 'bg-argo-accent hover:bg-argo-accent/90 text-argo-bg'
                  : 'bg-transparent hover:bg-argo-surface text-argo-textSecondary',
              )}
              onClick={() => {
                if (isRecording) setIsRecording(false);
                else if (hasContent) handleSubmit();
                else setIsRecording(true);
              }}
              disabled={isLoading && !hasContent}
              aria-label="Send"
            >
              {isLoading ? (
                <Square className="h-4 w-4 fill-argo-bg animate-pulse" />
              ) : isRecording ? (
                <StopCircle className="h-5 w-5 text-argo-red" />
              ) : hasContent ? (
                <ArrowUp className="h-4 w-4 text-argo-bg" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
            </InlineButton>
          </PromptInputAction>
        </PromptInputActions>
      </PromptInput>

      <ImageViewDialog imageUrl={selectedImage} onClose={() => setSelectedImage(null)} />
    </>
  );
});
PromptInputBox.displayName = 'PromptInputBox';
