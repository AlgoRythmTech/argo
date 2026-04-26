import { z } from 'zod';

export const IsoDateString = z.string().datetime({ offset: true });
export type IsoDateString = z.infer<typeof IsoDateString>;

export const Slug = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'lowercase letters, digits and hyphens only');
export type Slug = z.infer<typeof Slug>;

export const ShortId = z.string().min(8).max(40);
export type ShortId = z.infer<typeof ShortId>;

export const EmailAddress = z.string().email().max(320);
export type EmailAddress = z.infer<typeof EmailAddress>;

export const Url = z.string().url().max(2048);
export type Url = z.infer<typeof Url>;

export const TimeZone = z
  .string()
  .min(3)
  .max(64)
  .refine((v) => v.includes('/') || v === 'UTC', 'IANA timezone, e.g. America/New_York');
export type TimeZone = z.infer<typeof TimeZone>;
