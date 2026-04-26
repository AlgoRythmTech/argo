import type { WorkflowMap } from '@argo/shared-types';

/**
 * Generates the public form endpoint that Maya pastes into her recruiting
 * site. This is the URL Blaxel exposes; candidates submit here directly.
 *
 * Section 12 defaults applied:
 *   - Zod validation (the schema generator already produced SubmissionSchema)
 *   - Rate limit: 60/min/IP (the Fastify plugin is registered in scaffold)
 *   - Webhook signatures NOT required for forms (this is a public endpoint)
 *   - PII sent into the runtime_events sink is hashed
 */
export function generateFormRoute(map: WorkflowMap): string {
  const trigger = map.trigger.type === 'form_submission' ? map.trigger : null;
  const formTitle = trigger?.formTitle ?? map.operationName;
  const confirmationMessage =
    trigger?.confirmationMessage ?? 'Thanks. We\'ve received your submission.';

  return `import { nanoid } from 'nanoid';
import { SubmissionSchema } from '../schema/submission.js';

const RATE = { max: 60, timeWindow: '1 minute' };

export function registerFormRoute(app) {
  app.get('/', async (request, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return renderFormHtml();
  });

  app.post('/submissions', { config: { rateLimit: RATE } }, async (request, reply) => {
    const parsed = SubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_submission',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }

    const submissionId = 'sub_' + nanoid(16);
    const receivedAt = new Date().toISOString();

    await app.mongo.db.collection('submissions').insertOne({
      _id: submissionId,
      operationId: process.env.ARGO_OPERATION_ID,
      receivedAt,
      payload: parsed.data,
      status: 'received',
    });

    // Notify Argo control plane.
    fetch(process.env.ARGO_CONTROL_PLANE_URL + '/internal/submission', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-argo-internal': process.env.INTERNAL_API_KEY ?? '',
      },
      body: JSON.stringify({
        operationId: process.env.ARGO_OPERATION_ID,
        submissionId,
        receivedAt,
        payload: parsed.data,
      }),
    }).catch((err) => app.log.warn({ err }, 'control plane notify failed'));

    return reply.code(202).send({ ok: true, submissionId, message: ${JSON.stringify(confirmationMessage)} });
  });
}

function renderFormHtml() {
  return ${'`'}<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(formTitle)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:600px;margin:48px auto;padding:0 16px;color:#1a1a1a}label{display:block;margin:16px 0 6px;font-weight:600}input,textarea,select{width:100%;padding:10px 12px;border:1px solid #d4d4d8;border-radius:6px;font:inherit;box-sizing:border-box}textarea{min-height:120px;resize:vertical}button{margin-top:24px;background:#0a0a0b;color:#fff;border:0;padding:12px 20px;border-radius:6px;font:inherit;cursor:pointer}button:hover{background:#262626}.ok{color:#0a7d6c;margin-top:16px}.err{color:#a14a4a;margin-top:16px}</style></head>
<body><h1>${escapeHtml(formTitle)}</h1>
${trigger ? renderFormFieldsHtml(trigger.fields) : '<p>No fields configured.</p>'}
<div id="msg"></div>
<script>
document.getElementById('argo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const res = await fetch('/submissions', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(data) });
  const j = await res.json();
  const msg = document.getElementById('msg');
  if (res.ok) { msg.className='ok'; msg.textContent = j.message || 'Thanks.'; form.reset(); }
  else { msg.className='err'; msg.textContent = 'Something didn\\'t look right. Please check your entries.'; }
});
</script>
</body></html>${'`'};
}
`;

  function renderFormFieldsHtml(fields: NonNullable<typeof trigger>['fields']): string {
    return [
      '<form id="argo-form">',
      ...fields.map((f) => {
        const label = `<label for="${escapeHtml(f.id)}">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>`;
        switch (f.type) {
          case 'long_text':
            return `${label}<textarea id="${escapeHtml(f.id)}" name="${escapeHtml(f.id)}"${f.required ? ' required' : ''}></textarea>`;
          case 'select':
            return `${label}<select id="${escapeHtml(f.id)}" name="${escapeHtml(f.id)}"${f.required ? ' required' : ''}>${(f.options ?? []).map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select>`;
          case 'number':
            return `${label}<input id="${escapeHtml(f.id)}" name="${escapeHtml(f.id)}" type="number"${f.required ? ' required' : ''}>`;
          case 'email':
            return `${label}<input id="${escapeHtml(f.id)}" name="${escapeHtml(f.id)}" type="email"${f.required ? ' required' : ''}>`;
          case 'phone':
            return `${label}<input id="${escapeHtml(f.id)}" name="${escapeHtml(f.id)}" type="tel"${f.required ? ' required' : ''}>`;
          case 'url':
            return `${label}<input id="${escapeHtml(f.id)}" name="${escapeHtml(f.id)}" type="url"${f.required ? ' required' : ''}>`;
          case 'date':
            return `${label}<input id="${escapeHtml(f.id)}" name="${escapeHtml(f.id)}" type="date"${f.required ? ' required' : ''}>`;
          default:
            return `${label}<input id="${escapeHtml(f.id)}" name="${escapeHtml(f.id)}" type="text"${f.required ? ' required' : ''}>`;
        }
      }),
      '<button type="submit">Submit</button>',
      '</form>',
    ].join('\n');
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
