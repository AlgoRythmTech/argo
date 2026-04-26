// argo:upstream 21st.dev@liquid-glass-button
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const liquidButtonVariants = cva(
  'inline-flex items-center transition-colors justify-center cursor-pointer gap-2 whitespace-nowrap rounded-md text-sm font-medium disabled:pointer-events-none disabled:opacity-50 shrink-0 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]',
  {
    variants: {
      variant: {
        default: 'bg-transparent hover:scale-105 duration-300 transition text-argo-text',
        destructive: 'bg-argo-red text-white hover:bg-argo-red/90',
        outline:
          'border border-argo-border bg-transparent hover:bg-argo-surfaceAlt text-argo-text',
        secondary: 'bg-argo-surface text-argo-text hover:bg-argo-surfaceAlt',
        ghost: 'hover:bg-argo-surfaceAlt text-argo-text',
        link: 'text-argo-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 text-xs gap-1.5 px-4',
        lg: 'h-10 rounded-md px-6',
        xl: 'h-12 rounded-md px-8',
        xxl: 'h-14 rounded-md px-10',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'xxl' },
  },
);

export interface LiquidButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof liquidButtonVariants> {
  asChild?: boolean;
}

export function LiquidButton({
  className,
  variant,
  size,
  asChild = false,
  children,
  ...props
}: LiquidButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn('relative', liquidButtonVariants({ variant, size, className }))}
      {...props}
    >
      <div
        className="absolute top-0 left-0 z-0 h-full w-full rounded-full transition-all"
        style={{
          boxShadow:
            '0 0 6px rgba(0,0,0,0.03), 0 2px 6px rgba(0,0,0,0.08), inset 3px 3px 0.5px -3.5px rgba(255,255,255,0.4), inset -3px -3px 0.5px -3.5px rgba(255,255,255,0.4), inset 1px 1px 1px -0.5px rgba(255,255,255,0.6), inset -1px -1px 1px -0.5px rgba(255,255,255,0.6), inset 0 0 6px 6px rgba(255,255,255,0.06), inset 0 0 2px 2px rgba(255,255,255,0.04), 0 0 12px rgba(0,0,0,0.4)',
        }}
      />
      <div className="pointer-events-none z-10">{children}</div>
    </Comp>
  );
}
