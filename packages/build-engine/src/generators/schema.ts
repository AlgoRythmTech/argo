import type { WorkflowMap } from '@argo/shared-types';

/**
 * Generates the Mongo collection definitions and the Zod schema for the
 * form payload. The form schema is the validation contract every submission
 * passes through before the database call.
 */

export function generateZodSubmissionSchema(map: WorkflowMap): string {
  const trigger = map.trigger;
  if (trigger.type !== 'form_submission') {
    return `import { z } from 'zod';
export const SubmissionSchema = z.object({}).passthrough();
export type Submission = z.infer<typeof SubmissionSchema>;
`;
  }

  const fieldEntries = trigger.fields
    .map((f) => {
      const required = f.required ? '' : '.optional()';
      const helper = f.helpText ? ` // ${escapeComment(f.helpText)}` : '';
      let zodType = 'z.string()';
      switch (f.type) {
        case 'short_text':
          zodType = `z.string().min(1).max(${f.validation?.maxLength ?? 240})`;
          break;
        case 'long_text':
          zodType = `z.string().min(1).max(${f.validation?.maxLength ?? 8000})`;
          break;
        case 'email':
          zodType = `z.string().email().max(320)`;
          break;
        case 'phone':
          zodType = `z.string().min(7).max(40)`;
          break;
        case 'number':
          zodType = `z.coerce.number()${f.validation?.min !== undefined ? `.min(${f.validation.min})` : ''}${f.validation?.max !== undefined ? `.max(${f.validation.max})` : ''}`;
          break;
        case 'date':
          zodType = `z.string().min(8).max(40)`;
          break;
        case 'select':
          zodType = `z.enum([${(f.options ?? []).map((o) => JSON.stringify(o)).join(', ') || '"_unset_"'}])`;
          break;
        case 'multi_select':
          zodType = `z.array(z.enum([${(f.options ?? []).map((o) => JSON.stringify(o)).join(', ') || '"_unset_"'}]))`;
          break;
        case 'file_upload':
          zodType = `z.string().url()`;
          break;
        case 'url':
          zodType = `z.string().url().max(2048)`;
          break;
      }
      return `  ${JSON.stringify(f.id)}: ${zodType}${required},${helper}`;
    })
    .join('\n');

  return `import { z } from 'zod';

export const SubmissionSchema = z.object({
${fieldEntries}
}).strict();

export type Submission = z.infer<typeof SubmissionSchema>;
`;
}

function escapeComment(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').slice(0, 160);
}

export function generateMongoIndexes(map: WorkflowMap): string {
  return `import { connectMongo } from '../lib/mongo.js';

export async function ensureIndexes() {
  const { db } = await connectMongo();
  await db.collection('submissions').createIndex({ receivedAt: -1 });
  await db.collection('submissions').createIndex({ status: 1 });
  await db.collection('approvals').createIndex({ token: 1 }, { unique: true });
  await db.collection('approvals').createIndex({ expiresAt: 1 });
  await db.collection('emails_sent').createIndex({ approvalId: 1 });
  await db.collection('runtime_events').createIndex({ occurredAt: -1 });
}

ensureIndexes().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('index ensure failed', err);
});
`;
}
