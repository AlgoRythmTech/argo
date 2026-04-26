import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn-style class merging utility — used by every 21st.dev component.
 * Combines clsx (conditional class names) with tailwind-merge (de-duplicates
 * conflicting Tailwind utility classes, last-one-wins).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
