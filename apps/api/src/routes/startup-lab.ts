import type { FastifyInstance } from 'fastify';
import { request } from 'undici';
import { nanoid } from 'nanoid';
import { selfHostedWebResearch, scrapeUrl } from '@argo/agent';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { logger } from '../logger.js';

/**
 * Startup Lab — collaborative idea validation + AI-powered product synthesis.
 *
 * Flow:
 *   1. A group of co-founders create a "Lab" session
 *   2. Each person submits their startup idea
 *   3. Groq (fast inference) synthesizes the best product from all ideas
 *   4. Firecrawl researches the web to validate market demand
 *   5. The AI produces a validated product brief
 *   6. One click → GPT-5.5 builds the full app
 *
 * This is what NO competitor offers. Replit builds apps. Lovable builds UIs.
 * Argo validates your idea, researches the market, THEN builds.
 *
 * Models (via Groq for speed):
 *   - Qwen 3 32B for reasoning and synthesis
 *   - Llama 4 Scout for vision (analyzing competitor screenshots)
 *   - GPT OSS 120B for deep analysis
 *
 * Web research via Firecrawl:
 *   - Scrape competitor websites
 *   - Extract product features and pricing
 *   - Analyze market size indicators
 *   - Find user pain points from review sites
 */

const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const FIRECRAWL_API_BASE = 'https://api.firecrawl.dev/v1';

// ── Types ─────────────────────────────────────────────────────────────

interface LabIdea {
  id: string;
  authorName: string;
  title: string;
  description: string;
  targetAudience: string;
  problemSolved: string;
  submittedAt: string;
}

interface MarketResearch {
  competitors: Array<{
    name: string;
    url: string;
    description: string;
    pricing: string;
    strengths: string[];
    weaknesses: string[];
  }>;
  marketSize: string;
  trends: string[];
  painPoints: string[];
  opportunities: string[];
  verdict: string;
}

interface SynthesizedProduct {
  name: string;
  tagline: string;
  description: string;
  targetAudience: string;
  coreProblem: string;
  solution: string;
  uniqueValue: string;
  features: Array<{ name: string; description: string; priority: 'must-have' | 'nice-to-have' }>;
  monetization: string;
  marketResearch: MarketResearch;
  buildPrompt: string; // Ready to feed to GPT-5.5
  confidenceScore: number; // 0-100
  reasoning: string;
}

// ── Groq Client ───────────────────────────────────────────────────────

async function callGroq(args: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY ?? '';
  if (!groqKey) throw new Error('GROQ_API_KEY not configured');

  const body: Record<string, unknown> = {
    model: args.model,
    messages: [
      { role: 'system', content: args.systemPrompt },
      { role: 'user', content: args.userPrompt },
    ],
    max_completion_tokens: args.maxTokens ?? 4000,
    temperature: args.temperature ?? 0.7,
  };
  if (args.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const res = await request(`${GROQ_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${groqKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    bodyTimeout: 60_000,
  });

  const text = await res.body.text();
  if (res.statusCode >= 400) {
    throw new Error(`Groq ${args.model} → ${res.statusCode}: ${text.slice(0, 300)}`);
  }

  const parsed = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return parsed.choices?.[0]?.message?.content ?? '';
}

// ── Firecrawl Client ──────────────────────────────────────────────────

async function firecrawlSearch(query: string): Promise<Array<{ url: string; title: string; description: string; content: string }>> {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY ?? '';
  if (!firecrawlKey) {
    // Use self-hosted web research — no API key needed
    const result = await selfHostedWebResearch(query, 5);
    return result.results;
  }

  try {
    const res = await request(`${FIRECRAWL_API_BASE}/search`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${firecrawlKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit: 5,
        scrapeOptions: { formats: ['markdown'] },
      }),
      bodyTimeout: 30_000,
    });

    const text = await res.body.text();
    if (res.statusCode >= 400) {
      logger.warn({ status: res.statusCode }, 'firecrawl search failed');
      return [];
    }

    const data = JSON.parse(text) as {
      data?: Array<{ url?: string; title?: string; description?: string; markdown?: string }>;
    };

    return (data.data ?? []).map((r) => ({
      url: r.url ?? '',
      title: r.title ?? '',
      description: r.description ?? '',
      content: (r.markdown ?? '').slice(0, 2000),
    }));
  } catch (err) {
    logger.warn({ err }, 'firecrawl search crashed');
    return [];
  }
}

async function firecrawlScrape(url: string): Promise<string> {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY ?? '';
  if (!firecrawlKey) {
    const result = await scrapeUrl(url);
    return result.ok ? result.markdown : '';
  }

  try {
    const res = await request(`${FIRECRAWL_API_BASE}/scrape`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${firecrawlKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
      }),
      bodyTimeout: 30_000,
    });

    const text = await res.body.text();
    if (res.statusCode >= 400) return '';

    const data = JSON.parse(text) as { data?: { markdown?: string } };
    return (data.data?.markdown ?? '').slice(0, 5000);
  } catch {
    return '';
  }
}

// ── Routes ────────────────────────────────────────────────────────────

export async function registerStartupLabRoutes(app: FastifyInstance) {
  /**
   * POST /api/startup-lab/create — Create a new lab session.
   */
  app.post('/api/startup-lab/create', async (request_obj, reply) => {
    const session = requireSession(request_obj, reply);
    if (!session) return;

    const { name } = request_obj.body as { name?: string };
    const { db } = await getMongo();

    const labId = nanoid(12);
    const inviteCode = nanoid(6).toUpperCase();

    await db.collection('startup_labs').insertOne({
      labId,
      name: name ?? 'Untitled Lab',
      inviteCode,
      ownerId: session.userId,
      ideas: [],
      status: 'collecting', // collecting → synthesizing → researching → ready → building
      synthesizedProduct: null,
      createdAt: new Date().toISOString(),
    });

    return reply.code(201).send({
      ok: true,
      labId,
      inviteCode,
      joinUrl: `/lab/${inviteCode}`,
    });
  });

  /**
   * POST /api/startup-lab/:labId/idea — Submit an idea to the lab.
   */
  app.post('/api/startup-lab/:labId/idea', async (request_obj, reply) => {
    const session = requireSession(request_obj, reply);
    if (!session) return;

    const labId = String((request_obj.params as { labId: string }).labId);
    const body = request_obj.body as {
      title: string;
      description: string;
      targetAudience?: string;
      problemSolved?: string;
      authorName?: string;
    };

    if (!body.title || !body.description) {
      return reply.code(400).send({ error: 'title and description are required' });
    }

    const idea: LabIdea = {
      id: nanoid(8),
      authorName: body.authorName ?? 'Anonymous',
      title: body.title,
      description: body.description,
      targetAudience: body.targetAudience ?? '',
      problemSolved: body.problemSolved ?? '',
      submittedAt: new Date().toISOString(),
    };

    const { db } = await getMongo();
    await db.collection('startup_labs').updateOne(
      { labId },
      { $push: { ideas: idea } as never },
    );

    return reply.send({ ok: true, ideaId: idea.id });
  });

  /**
   * GET /api/startup-lab/:labId — Get lab status and ideas.
   */
  app.get('/api/startup-lab/:labId', async (request_obj, reply) => {
    const session = requireSession(request_obj, reply);
    if (!session) return;

    const labId = String((request_obj.params as { labId: string }).labId);
    const { db } = await getMongo();

    const lab = await db.collection('startup_labs').findOne({ labId });
    if (!lab) return reply.code(404).send({ error: 'lab_not_found' });

    return reply.send({
      labId: lab.labId,
      name: lab.name,
      inviteCode: lab.inviteCode,
      status: lab.status,
      ideas: lab.ideas,
      synthesizedProduct: lab.synthesizedProduct,
      createdAt: lab.createdAt,
    });
  });

  /**
   * POST /api/startup-lab/:labId/synthesize — AI synthesizes the best product.
   *
   * This is the magic: Groq thinks deeply about all submitted ideas,
   * Firecrawl researches the web for market validation, and the AI
   * produces a synthesized product brief ready for GPT-5.5 to build.
   */
  app.post('/api/startup-lab/:labId/synthesize', async (request_obj, reply) => {
    const session = requireSession(request_obj, reply);
    if (!session) return;

    const labId = String((request_obj.params as { labId: string }).labId);
    const { db } = await getMongo();

    const lab = await db.collection('startup_labs').findOne({ labId });
    if (!lab) return reply.code(404).send({ error: 'lab_not_found' });

    const ideas = lab.ideas as LabIdea[];
    if (ideas.length === 0) {
      return reply.code(400).send({ error: 'no_ideas', message: 'Submit at least one idea first.' });
    }

    await db.collection('startup_labs').updateOne(
      { labId },
      { $set: { status: 'synthesizing' } },
    );

    try {
      // ── Step 1: Groq synthesizes ideas ─────────────────────────────
      const ideasText = ideas.map((idea, i) =>
        `### Idea ${i + 1}: "${idea.title}" by ${idea.authorName}\n${idea.description}\nTarget: ${idea.targetAudience}\nProblem: ${idea.problemSolved}`,
      ).join('\n\n');

      const synthesisResult = await callGroq({
        model: 'qwen-qwq-32b',
        systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
        userPrompt: `Here are ${ideas.length} startup ideas from a founding team. Synthesize them into ONE optimal product.\n\n${ideasText}\n\nReturn a JSON object with: name, tagline, description, targetAudience, coreProblem, solution, uniqueValue, features (array of {name, description, priority}), monetization, confidenceScore (0-100), reasoning.`,
        maxTokens: 4000,
        jsonMode: true,
      });

      let synthesis: Partial<SynthesizedProduct>;
      try {
        synthesis = JSON.parse(synthesisResult);
      } catch {
        synthesis = { name: 'Synthesized Product', description: synthesisResult, confidenceScore: 50 };
      }

      // ── Step 2: Firecrawl researches the market ────────────────────
      await db.collection('startup_labs').updateOne(
        { labId },
        { $set: { status: 'researching' } },
      );

      const searchQuery = `${synthesis.name ?? ''} ${synthesis.coreProblem ?? ''} competitors market size`;
      const searchResults = await firecrawlSearch(searchQuery);

      // Scrape top 3 competitor sites for deeper analysis
      const competitorData: string[] = [];
      for (const result of searchResults.slice(0, 3)) {
        if (result.url) {
          const content = await firecrawlScrape(result.url);
          if (content) {
            competitorData.push(`## ${result.title}\nURL: ${result.url}\n${content.slice(0, 1500)}`);
          }
        }
      }

      // ── Step 3: Groq analyzes market research ──────────────────────
      const marketAnalysis = await callGroq({
        model: 'qwen-qwq-32b',
        systemPrompt: MARKET_ANALYSIS_SYSTEM_PROMPT,
        userPrompt: `Product idea: ${synthesis.name} — ${synthesis.description}\n\nWeb research results:\n${competitorData.join('\n\n')}\n\nSearch results:\n${searchResults.map((r) => `- ${r.title}: ${r.description}`).join('\n')}\n\nReturn a JSON object with: competitors (array of {name, url, description, pricing, strengths[], weaknesses[]}), marketSize, trends[], painPoints[], opportunities[], verdict.`,
        maxTokens: 3000,
        jsonMode: true,
      });

      let research: MarketResearch;
      try {
        research = JSON.parse(marketAnalysis);
      } catch {
        research = {
          competitors: [],
          marketSize: 'Unknown',
          trends: [],
          painPoints: [],
          opportunities: [],
          verdict: marketAnalysis.slice(0, 500),
        };
      }

      // ── Step 4: Generate the build prompt ──────────────────────────
      const buildPrompt = `Build a complete full-stack application for "${synthesis.name}".

${synthesis.description}

Target audience: ${synthesis.targetAudience ?? 'Startup founders and small businesses'}

Core problem solved: ${synthesis.coreProblem ?? 'Unspecified'}

Features (must-have):
${(synthesis.features ?? []).filter((f) => f.priority === 'must-have').map((f) => `- ${f.name}: ${f.description}`).join('\n')}

Features (nice-to-have):
${(synthesis.features ?? []).filter((f) => f.priority === 'nice-to-have').map((f) => `- ${f.name}: ${f.description}`).join('\n')}

Monetization: ${synthesis.monetization ?? 'Freemium'}

Unique value proposition: ${synthesis.uniqueValue ?? synthesis.tagline ?? ''}

Market context:
- Market size: ${research.marketSize}
- Key competitors: ${research.competitors.map((c) => c.name).join(', ')}
- Key opportunity: ${research.opportunities[0] ?? 'First-mover advantage'}

Build this as a production-ready full-stack application with React + Tailwind frontend, Fastify + MongoDB backend, authentication, and a professional dark-mode UI. Not a prototype — a real product.`;

      const product: SynthesizedProduct = {
        name: synthesis.name ?? 'Untitled Product',
        tagline: synthesis.tagline ?? '',
        description: synthesis.description ?? '',
        targetAudience: synthesis.targetAudience ?? '',
        coreProblem: synthesis.coreProblem ?? '',
        solution: synthesis.solution ?? '',
        uniqueValue: synthesis.uniqueValue ?? '',
        features: synthesis.features ?? [],
        monetization: synthesis.monetization ?? '',
        marketResearch: research,
        buildPrompt,
        confidenceScore: synthesis.confidenceScore ?? 50,
        reasoning: synthesis.reasoning ?? '',
      };

      await db.collection('startup_labs').updateOne(
        { labId },
        { $set: { status: 'ready', synthesizedProduct: product } },
      );

      logger.info(
        { labId, productName: product.name, confidence: product.confidenceScore },
        'startup lab synthesis complete',
      );

      return reply.send({ ok: true, product });
    } catch (err) {
      await db.collection('startup_labs').updateOne(
        { labId },
        { $set: { status: 'collecting' } },
      );
      logger.error({ err, labId }, 'startup lab synthesis failed');
      return reply.code(500).send({
        error: 'synthesis_failed',
        message: String((err as Error)?.message ?? err).slice(0, 300),
      });
    }
  });
}

// ── System Prompts ────────────────────────────────────────────────────

const SYNTHESIS_SYSTEM_PROMPT = `
You are a startup product strategist. A founding team has submitted multiple startup ideas. Your job is to SYNTHESIZE them into ONE optimal product that:

1. Takes the BEST elements from each idea
2. Addresses the largest market opportunity
3. Has a clear, defensible unique value proposition
4. Can be built as an MVP in under a week
5. Has obvious monetization potential

Think deeply. Consider market timing, competitive landscape, team strengths, and user urgency. The output should be a product that a YC partner would fund.

Return ONLY a JSON object. No markdown, no prose.
`.trim();

const MARKET_ANALYSIS_SYSTEM_PROMPT = `
You are a market research analyst. Given a product idea and web research results, produce a structured market analysis.

Analyze:
1. Who are the competitors? What do they charge? What are their strengths/weaknesses?
2. How big is the market? (TAM/SAM/SOM if possible)
3. What are the current trends?
4. What pain points do users have with existing solutions?
5. What opportunities exist for a new entrant?
6. Overall verdict: is this worth building?

Be honest. If the market is saturated, say so. If the idea is bad, say so. Founders need truth, not encouragement.

Return ONLY a JSON object. No markdown, no prose.
`.trim();
