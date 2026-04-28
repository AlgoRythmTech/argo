import type { FastifyInstance } from 'fastify';
import { request } from 'undici';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { appendActivity } from '../stores/activity-store.js';
import { logger } from '../logger.js';

/**
 * Image-to-App API — upload a screenshot, get a working app.
 *
 * Users can:
 *   1. Upload a screenshot of a competitor's product
 *   2. Upload a wireframe or mockup
 *   3. Upload a hand-drawn sketch
 *   4. Upload a Figma export
 *
 * GPT-5.5's vision capability analyzes the image and generates a
 * detailed project brief, which feeds into the standard build pipeline.
 *
 * This matches Lovable's image-to-app feature but goes further:
 * we generate FULL-STACK apps (backend + frontend), not just React UI.
 */

export async function registerImageToAppRoutes(app: FastifyInstance) {
  /**
   * POST /api/image-to-app/analyze
   *
   * Accepts a base64-encoded image and returns a structured project
   * brief that can be fed to the builder.
   */
  app.post('/api/image-to-app/analyze', async (request_obj, reply) => {
    const session = requireSession(request_obj, reply);
    if (!session) return;

    const body = request_obj.body as {
      image: string; // base64 encoded
      mimeType?: string; // 'image/png' | 'image/jpeg' | 'image/webp'
      additionalContext?: string; // "Make it like this but add auth"
    };

    if (!body.image) {
      return reply.code(400).send({ error: 'missing_image', message: 'image (base64) is required' });
    }

    const apiKey = process.env.OPENAI_API_KEY ?? '';
    const emergentKey = process.env.EMERGENT_API_KEY ?? '';
    const emergentEnabled = (process.env.EMERGENT_ENABLED ?? '').toLowerCase() === 'true';

    const effectiveKey = apiKey || (emergentEnabled ? emergentKey : '');
    const effectiveBase = apiKey
      ? (process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1')
      : (process.env.EMERGENT_API_BASE ?? 'https://api.emergent.sh/v1');

    if (!effectiveKey) {
      return reply.code(503).send({ error: 'no_api_key', message: 'No OpenAI or Emergent API key configured' });
    }

    const mimeType = body.mimeType ?? 'image/png';
    const model = process.env.OPENAI_MODEL_PRIMARY ?? 'gpt-5.5';

    try {
      const res = await request(`${effectiveBase}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${effectiveKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: 4000,
          response_format: { type: 'json_object' as const },
          messages: [
            {
              role: 'system' as const,
              content: IMAGE_ANALYSIS_SYSTEM_PROMPT,
            },
            {
              role: 'user' as const,
              content: [
                {
                  type: 'image_url' as const,
                  image_url: {
                    url: `data:${mimeType};base64,${body.image}`,
                    detail: 'high' as const,
                  },
                },
                {
                  type: 'text' as const,
                  text: body.additionalContext
                    ? `Analyze this screenshot and generate a project brief. Additional context from the user: "${body.additionalContext}"`
                    : 'Analyze this screenshot and generate a complete project brief for building this as a full-stack application.',
                },
              ],
            },
          ],
        }),
        bodyTimeout: 120_000,
        headersTimeout: 30_000,
      });

      const text = await res.body.text();
      if (res.statusCode >= 400) {
        logger.error({ status: res.statusCode, body: text.slice(0, 300) }, 'image analysis API call failed');
        return reply.code(502).send({
          error: 'analysis_failed',
          message: `GPT-5.5 vision returned ${res.statusCode}`,
          detail: text.slice(0, 300),
        });
      }

      const parsed = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      const content = parsed.choices?.[0]?.message?.content ?? '';
      let brief: ImageAnalysisBrief;
      try {
        brief = JSON.parse(content) as ImageAnalysisBrief;
      } catch {
        return reply.code(422).send({
          error: 'parse_failed',
          message: 'GPT-5.5 returned invalid JSON from image analysis',
          raw: content.slice(0, 500),
        });
      }

      // Record the analysis
      const { db } = await getMongo();
      await db.collection('image_analyses').insertOne({
        ownerId: session.userId,
        brief,
        model,
        tokensUsed: parsed.usage?.total_tokens ?? 0,
        additionalContext: body.additionalContext ?? null,
        createdAt: new Date().toISOString(),
      });

      await appendActivity({
        ownerId: session.userId,
        operationId: null,
        operationName: null,
        kind: 'image_analyzed',
        message: `Analyzed screenshot: "${brief.appName}" — ${brief.pages.length} pages, ${brief.features.length} features detected.`,
      });

      logger.info(
        { appName: brief.appName, pages: brief.pages.length, features: brief.features.length },
        'image-to-app analysis complete',
      );

      return reply.send({
        ok: true,
        brief,
        usage: {
          model,
          promptTokens: parsed.usage?.prompt_tokens ?? 0,
          completionTokens: parsed.usage?.completion_tokens ?? 0,
          totalTokens: parsed.usage?.total_tokens ?? 0,
        },
      });
    } catch (err) {
      logger.error({ err }, 'image-to-app analysis crashed');
      return reply.code(500).send({
        error: 'analysis_crash',
        message: String((err as Error)?.message ?? err).slice(0, 300),
      });
    }
  });
}

// ── Types ─────────────────────────────────────────────────────────────

interface ImageAnalysisBrief {
  appName: string;
  appDescription: string;
  appType: 'saas' | 'dashboard' | 'landing' | 'ecommerce' | 'social' | 'productivity' | 'other';
  pages: Array<{
    name: string;
    description: string;
    components: string[];
    dataNeeded: string[];
  }>;
  features: Array<{
    name: string;
    description: string;
    priority: 'must-have' | 'nice-to-have';
  }>;
  dataModel: Array<{
    entity: string;
    fields: Array<{ name: string; type: string; required: boolean }>;
    relationships: string[];
  }>;
  colorScheme: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    mode: 'light' | 'dark' | 'both';
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    style: 'modern' | 'classic' | 'playful' | 'minimal';
  };
  techStack: {
    needsAuth: boolean;
    needsDatabase: boolean;
    needsPayments: boolean;
    needsRealtime: boolean;
    needsFileUpload: boolean;
    needsEmail: boolean;
  };
  buildPrompt: string; // The full prompt to send to the build engine
}

// ── System Prompt ─────────────────────────────────────────────────────

const IMAGE_ANALYSIS_SYSTEM_PROMPT = `
You are Argo's image analysis agent. You receive a screenshot of an app,
website, wireframe, or mockup, and you produce a detailed JSON project
brief that the build engine will use to generate a FULL-STACK application.

Your output must be a single JSON object with this structure:

{
  "appName": "string — a descriptive name for the app",
  "appDescription": "string — 2-3 sentences describing what this app does",
  "appType": "saas|dashboard|landing|ecommerce|social|productivity|other",
  "pages": [
    {
      "name": "string — page name (e.g., 'Dashboard', 'Settings')",
      "description": "what this page shows and does",
      "components": ["list of UI components visible"],
      "dataNeeded": ["what data this page displays or collects"]
    }
  ],
  "features": [
    {
      "name": "string",
      "description": "what it does",
      "priority": "must-have|nice-to-have"
    }
  ],
  "dataModel": [
    {
      "entity": "User",
      "fields": [{"name": "email", "type": "string", "required": true}],
      "relationships": ["has many Projects"]
    }
  ],
  "colorScheme": {
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "background": "#hex",
    "text": "#hex",
    "mode": "light|dark|both"
  },
  "typography": {
    "headingFont": "Inter|Geist|system-ui|etc",
    "bodyFont": "Inter|system-ui|etc",
    "style": "modern|classic|playful|minimal"
  },
  "techStack": {
    "needsAuth": true/false,
    "needsDatabase": true/false,
    "needsPayments": true/false,
    "needsRealtime": true/false,
    "needsFileUpload": true/false,
    "needsEmail": true/false
  },
  "buildPrompt": "A detailed 3-5 paragraph prompt describing EVERYTHING the build engine needs to create this app. Include: what it does, who uses it, what pages it has, what data it stores, what interactions it supports, what the design looks like. This is the most important field — it feeds directly into GPT-5.5 for code generation."
}

# Rules

- Be SPECIFIC about components. Not "a list" — "a sortable data table with 5 columns: Name, Email, Status (badge), Created (relative date), Actions (edit/delete buttons)."
- Be SPECIFIC about colors. Extract actual hex values from the screenshot.
- Be SPECIFIC about data. Not "user data" — "users with email, name, role (admin/member), avatar URL, created timestamp."
- The buildPrompt must be detailed enough that someone who NEVER saw the screenshot could build the same app from the description alone.
- Identify the app type correctly. A Stripe dashboard is "saas". A personal blog is "landing". A Trello board is "productivity".
- List ALL pages visible or implied. A settings page is implied even if not shown.
- List ALL features visible. Search bars, filters, pagination, dark mode toggles — everything.
`.trim();
