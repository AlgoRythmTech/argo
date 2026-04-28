import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import type { ProjectBrief } from '@argo/shared-types';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { appendActivity } from '../stores/activity-store.js';
import { logger } from '../logger.js';

// ── Template type ──────────────────────────────────────────────────────

export type Template = {
  slug: string;
  name: string;
  category: 'workflow' | 'saas' | 'integration' | 'ai-agent';
  description: string;
  icon: string; // lucide icon name
  tags: string[];
  estimatedBuildTime: string;
  fileCount: number;
  features: string[];
  brief: Partial<ProjectBrief>;
};

// ── Template catalogue ─────────────────────────────────────────────────

const TEMPLATES: Template[] = [
  {
    slug: 'recruiting-pipeline',
    name: 'Recruiting Pipeline',
    category: 'workflow',
    description:
      'Form intake for applicants, AI-powered screening and scoring, approval emails to hiring managers, and a weekly digest of pipeline status.',
    icon: 'Briefcase',
    tags: ['recruiting', 'hr', 'email', 'forms', 'ai-screening'],
    estimatedBuildTime: '~2 min',
    fileCount: 12,
    features: [
      'Application intake form with resume upload',
      'AI candidate scoring and fit analysis',
      'One-click approval/reject emails to hiring managers',
      'Weekly pipeline digest with stats',
    ],
    brief: {
      name: 'Recruiting Pipeline',
      audience: 'Hiring managers and recruiters reviewing inbound applications',
      outcome:
        'Automatically screen applicants, score fit, send personalised rejection emails, and forward strong candidates for one-click manager approval with a weekly digest.',
      trigger: 'form_submission',
      fields: [
        { id: 'full_name', label: 'Full Name', type: 'short_text', required: true, options: [] },
        { id: 'email', label: 'Email', type: 'email', required: true, options: [] },
        { id: 'phone', label: 'Phone', type: 'phone', required: false, options: [] },
        { id: 'role', label: 'Role Applied For', type: 'short_text', required: true, options: [] },
        { id: 'resume', label: 'Resume / CV', type: 'file_upload', required: true, options: [] },
        { id: 'cover_note', label: 'Cover Note', type: 'long_text', required: false, options: [] },
      ],
      integrations: ['gmail', 'openai', 'mongodb'],
      auth: 'magic_link',
      persistence: 'mongodb',
      replyStyle: 'warm',
      successCriteria: [
        'Reject emails sent within 10 minutes of submission',
        'Strong candidates forwarded with full context',
        'Weekly digest delivered every Monday at 9 AM',
      ],
      scheduling: { digestEnabled: true, digestCron: '0 9 * * 1', digestTimezone: 'America/New_York' },
    },
  },
  {
    slug: 'recruiting-intake-pro',
    name: 'Recruiting Intake Pro',
    category: 'workflow',
    description:
      'Complete recruiting workflow: multi-role intake forms, AI candidate scoring with resume parsing, client-specific approval chains, automated interview scheduling, and a Monday morning pipeline digest.',
    icon: 'Users',
    tags: ['recruiting', 'hr', 'intake', 'ai-screening', 'scheduling', 'digest'],
    estimatedBuildTime: '~3 min',
    fileCount: 18,
    features: [
      'Multi-role intake forms with custom screening criteria per role',
      'AI resume parsing and candidate scoring (1-100)',
      'Client-specific approval chains with SLA tracking',
      'Automated interview scheduling with calendar integration',
      'Polite, personalized rejection emails with specific feedback',
      'Monday morning pipeline digest with week-over-week metrics',
      'Candidate pipeline Kanban view',
      'Client portal with read-only pipeline access',
    ],
    brief: {
      name: 'Recruiting Intake Pro',
      audience: 'Recruiting agencies managing candidate intake for multiple clients',
      outcome:
        'Run candidate intake end-to-end: candidates apply through a branded form, AI screens and scores each application against role requirements, strong matches are forwarded to the hiring client for one-click approval, rejected candidates receive personalized feedback emails, and the agency gets a Monday morning digest with pipeline metrics.',
      trigger: 'form_submission',
      fields: [
        { id: 'full_name', label: 'Full Name', type: 'short_text', required: true, options: [] },
        { id: 'email', label: 'Email', type: 'email', required: true, options: [] },
        { id: 'phone', label: 'Phone', type: 'phone', required: false, options: [] },
        { id: 'role', label: 'Position Applied For', type: 'short_text', required: true, options: [] },
        { id: 'experience_years', label: 'Years of Experience', type: 'number', required: true, options: [] },
        { id: 'resume', label: 'Resume / CV', type: 'file_upload', required: true, options: [] },
        { id: 'portfolio_url', label: 'Portfolio / LinkedIn URL', type: 'url', required: false, options: [] },
        { id: 'cover_note', label: 'Why are you interested?', type: 'long_text', required: false, options: [] },
        { id: 'salary_expectation', label: 'Salary Expectation', type: 'short_text', required: false, options: [] },
        { id: 'availability', label: 'Earliest Start Date', type: 'date', required: false, options: [] },
      ],
      integrations: ['gmail', 'openai', 'mongodb', 'calendly'],
      auth: 'magic_link',
      persistence: 'mongodb',
      replyStyle: 'warm',
      successCriteria: [
        'Every candidate gets a response within 24 hours',
        'Strong matches (score 75+) forwarded to client within 4 hours',
        'Rejection emails are personalized with specific feedback on fit',
        'Monday digest delivered by 9 AM with pipeline metrics',
        'Client approval turnaround tracked with SLA warnings',
      ],
      scheduling: { digestEnabled: true, digestCron: '0 9 * * 1', digestTimezone: 'America/New_York' },
    },
  },
  {
    slug: 'lead-qualification',
    name: 'Lead Qualification Engine',
    category: 'workflow',
    description:
      'Score inbound leads by company size, budget, and fit. Route hot leads to sales instantly, nurture warm leads with drip emails, and archive cold leads.',
    icon: 'Target',
    tags: ['sales', 'leads', 'qualification', 'routing', 'drip-email'],
    estimatedBuildTime: '~2 min',
    fileCount: 13,
    features: [
      'AI lead scoring (1-100) based on company data',
      'Instant routing: hot (80+) to sales, warm (50-79) to nurture, cold (<50) to archive',
      'Automated drip email sequences for warm leads',
      'CRM-style lead management dashboard',
      'Weekly conversion funnel report',
    ],
    brief: {
      name: 'Lead Qualification Engine',
      audience: 'Sales teams qualifying inbound leads from website forms and marketing campaigns',
      outcome:
        'Score each inbound lead using AI analysis of company size, budget, timeline, and product fit. Route hot leads to sales with full context for immediate follow-up. Enter warm leads into automated nurture sequences. Archive cold leads with reason codes.',
      trigger: 'form_submission',
      fields: [
        { id: 'name', label: 'Name', type: 'short_text', required: true, options: [] },
        { id: 'email', label: 'Work Email', type: 'email', required: true, options: [] },
        { id: 'company', label: 'Company', type: 'short_text', required: true, options: [] },
        { id: 'company_size', label: 'Company Size', type: 'select', required: true, options: ['1-10', '11-50', '51-200', '201-1000', '1000+'] },
        { id: 'budget', label: 'Budget Range', type: 'select', required: false, options: ['<$1K', '$1K-$5K', '$5K-$25K', '$25K-$100K', '$100K+'] },
        { id: 'timeline', label: 'Timeline', type: 'select', required: false, options: ['Immediately', '1-3 months', '3-6 months', '6+ months', 'Just exploring'] },
        { id: 'use_case', label: 'What are you looking to solve?', type: 'long_text', required: true, options: [] },
      ],
      integrations: ['gmail', 'openai', 'mongodb', 'slack'],
      auth: 'none',
      persistence: 'mongodb',
      replyStyle: 'brief',
      successCriteria: [
        'Leads scored and routed within 5 minutes of submission',
        'Hot leads get sales follow-up within 1 hour',
        'Warm leads enter nurture sequence within 24 hours',
      ],
      scheduling: { digestEnabled: true, digestCron: '0 8 * * 1-5', digestTimezone: 'America/New_York' },
    },
  },
  {
    slug: 'customer-onboarding',
    name: 'Customer Onboarding',
    category: 'workflow',
    description:
      'Welcome email sequences, task scheduling for setup milestones, and progress tracking dashboard for new customers.',
    icon: 'UserPlus',
    tags: ['onboarding', 'email', 'scheduling', 'crm'],
    estimatedBuildTime: '~2 min',
    fileCount: 10,
    features: [
      'Welcome email with personalised setup checklist',
      'Automated task scheduling for onboarding milestones',
      'Progress tracking with completion percentage',
      'Escalation alerts for stalled onboardings',
    ],
    brief: {
      name: 'Customer Onboarding',
      audience: 'New customers going through initial setup and activation',
      outcome:
        'Guide new customers through onboarding with automated welcome emails, scheduled milestone tasks, progress tracking, and escalation when onboarding stalls.',
      trigger: 'form_submission',
      fields: [
        { id: 'company_name', label: 'Company Name', type: 'short_text', required: true, options: [] },
        { id: 'contact_email', label: 'Contact Email', type: 'email', required: true, options: [] },
        { id: 'contact_name', label: 'Contact Name', type: 'short_text', required: true, options: [] },
        { id: 'plan', label: 'Plan', type: 'select', required: true, options: ['Starter', 'Pro', 'Enterprise'] },
      ],
      integrations: ['gmail', 'mongodb', 'slack'],
      auth: 'magic_link',
      persistence: 'mongodb',
      replyStyle: 'warm',
      successCriteria: [
        'Welcome email sent within 5 minutes of signup',
        'Milestone reminders delivered on schedule',
        'Stalled onboardings escalated after 3 days of inactivity',
      ],
      scheduling: { digestEnabled: true, digestCron: '0 9 * * 1', digestTimezone: 'America/New_York' },
    },
  },
  {
    slug: 'invoice-processor',
    name: 'Invoice Processor',
    category: 'workflow',
    description:
      'Email intake for invoices, AI-powered PDF parsing and data extraction, approval routing by amount, and accounting system export.',
    icon: 'Receipt',
    tags: ['finance', 'invoices', 'pdf', 'approval', 'email'],
    estimatedBuildTime: '~3 min',
    fileCount: 14,
    features: [
      'Email-based invoice intake with PDF attachment parsing',
      'AI data extraction: vendor, amount, line items, due date',
      'Approval routing by dollar threshold',
      'Export to accounting system (CSV/API)',
    ],
    brief: {
      name: 'Invoice Processor',
      audience: 'Finance teams processing vendor invoices and purchase orders',
      outcome:
        'Receive invoices by email, parse PDF attachments with AI to extract vendor, amount, and line items, route for approval based on dollar thresholds, and export approved invoices for accounting.',
      trigger: 'email_received',
      integrations: ['gmail', 'openai', 'mongodb', 's3'],
      auth: 'magic_link',
      persistence: 'mongodb',
      dataClassification: 'pii',
      replyStyle: 'formal',
      successCriteria: [
        'Invoices parsed within 2 minutes of receipt',
        'Extraction accuracy above 95% for standard invoices',
        'Approvals processed within 24 hours',
      ],
      scheduling: { digestEnabled: true, digestCron: '0 8 * * 1-5', digestTimezone: 'America/New_York' },
    },
  },
  {
    slug: 'saas-starter',
    name: 'SaaS Starter',
    category: 'saas',
    description:
      'Full-stack SaaS foundation with authentication, role-based access control, Stripe billing, admin panel, and REST API.',
    icon: 'Layers',
    tags: ['saas', 'auth', 'billing', 'rbac', 'api', 'admin'],
    estimatedBuildTime: '~4 min',
    fileCount: 22,
    features: [
      'Authentication with magic link + OAuth',
      'Role-based access control (admin, member, viewer)',
      'Stripe billing integration with plans',
      'Admin panel with user management',
      'REST API with rate limiting',
    ],
    brief: {
      name: 'SaaS Starter',
      audience: 'End users signing up for a multi-tenant SaaS product',
      outcome:
        'Provide a production-ready SaaS foundation with authentication, RBAC, Stripe billing with plan management, an admin panel, and a rate-limited REST API.',
      trigger: 'form_submission',
      fields: [
        { id: 'email', label: 'Email', type: 'email', required: true, options: [] },
        { id: 'full_name', label: 'Full Name', type: 'short_text', required: true, options: [] },
        { id: 'company', label: 'Company', type: 'short_text', required: false, options: [] },
      ],
      integrations: ['stripe', 'mongodb', 'gmail'],
      auth: 'magic_link',
      persistence: 'mongodb',
      replyStyle: 'brief',
      successCriteria: [
        'User can sign up and access dashboard within 30 seconds',
        'Billing portal accessible from settings',
        'Admin can invite and manage team members',
      ],
    },
  },
  {
    slug: 'webhook-bridge',
    name: 'Webhook Bridge',
    category: 'integration',
    description:
      'Receive webhooks from any source, transform payloads with configurable mappings, and fan out to multiple downstream destinations.',
    icon: 'Webhook',
    tags: ['webhooks', 'integration', 'transform', 'fan-out', 'api'],
    estimatedBuildTime: '~2 min',
    fileCount: 8,
    features: [
      'Universal webhook receiver with signature verification',
      'Configurable JSON payload transformation',
      'Fan-out to multiple destinations (Slack, email, webhooks)',
      'Request logging and replay for debugging',
    ],
    brief: {
      name: 'Webhook Bridge',
      audience: 'Developers integrating third-party services via webhooks',
      outcome:
        'Receive inbound webhooks, validate signatures, transform payloads according to configurable mappings, and fan out to multiple downstream destinations with retry logic.',
      trigger: 'webhook',
      integrations: ['webhooks_inbound', 'webhooks_outbound', 'slack', 'mongodb'],
      auth: 'api_key',
      persistence: 'mongodb',
      replyStyle: 'brief',
      successCriteria: [
        'Webhooks acknowledged within 200ms',
        'Failed deliveries retried up to 3 times with backoff',
        'Full request/response logging for debugging',
      ],
    },
  },
  {
    slug: 'ai-content-pipeline',
    name: 'AI Content Pipeline',
    category: 'ai-agent',
    description:
      'AI-powered content generation from briefs, human review queue with approval workflow, and automated publishing to multiple channels.',
    icon: 'Sparkles',
    tags: ['ai', 'content', 'publishing', 'review', 'automation'],
    estimatedBuildTime: '~3 min',
    fileCount: 15,
    features: [
      'AI content generation from topic briefs',
      'Human review queue with inline editing',
      'Approval workflow before publishing',
      'Multi-channel publishing (email, blog, social)',
    ],
    brief: {
      name: 'AI Content Pipeline',
      audience: 'Content teams producing articles, newsletters, and social posts',
      outcome:
        'Generate draft content from topic briefs using AI, queue for human review with inline editing, route through approval, and publish to configured channels.',
      trigger: 'form_submission',
      fields: [
        { id: 'topic', label: 'Topic / Title', type: 'short_text', required: true, options: [] },
        { id: 'brief', label: 'Content Brief', type: 'long_text', required: true, options: [] },
        { id: 'tone', label: 'Tone', type: 'select', required: true, options: ['Professional', 'Casual', 'Technical', 'Conversational'] },
        { id: 'channels', label: 'Publish To', type: 'multi_select', required: true, options: ['Blog', 'Newsletter', 'Twitter', 'LinkedIn'] },
      ],
      integrations: ['openai', 'gmail', 'mongodb'],
      auth: 'magic_link',
      persistence: 'mongodb',
      replyStyle: 'warm',
      successCriteria: [
        'Draft generated within 60 seconds of brief submission',
        'Review notifications sent immediately',
        'Published within 5 minutes of approval',
      ],
    },
  },
  {
    slug: 'support-ticket-router',
    name: 'Support Ticket Router',
    category: 'workflow',
    description:
      'Intake support requests via email or form, classify priority and category with AI, and route to the right team automatically.',
    icon: 'LifeBuoy',
    tags: ['support', 'tickets', 'routing', 'email', 'ai-classification'],
    estimatedBuildTime: '~2 min',
    fileCount: 11,
    features: [
      'Email and form-based ticket intake',
      'AI-powered priority classification (P0-P3)',
      'Category detection (billing, bug, feature, account)',
      'Automatic team routing with escalation rules',
    ],
    brief: {
      name: 'Support Ticket Router',
      audience: 'Support teams handling inbound customer requests',
      outcome:
        'Accept support requests via email and web form, use AI to classify priority and category, route to the appropriate team, and escalate high-priority tickets with SLA tracking.',
      trigger: 'form_submission',
      fields: [
        { id: 'name', label: 'Your Name', type: 'short_text', required: true, options: [] },
        { id: 'email', label: 'Email', type: 'email', required: true, options: [] },
        { id: 'subject', label: 'Subject', type: 'short_text', required: true, options: [] },
        { id: 'description', label: 'Describe your issue', type: 'long_text', required: true, options: [] },
        { id: 'category', label: 'Category', type: 'select', required: false, options: ['Billing', 'Bug', 'Feature Request', 'Account', 'Other'] },
      ],
      integrations: ['gmail', 'openai', 'slack', 'mongodb'],
      auth: 'none',
      persistence: 'mongodb',
      replyStyle: 'warm',
      successCriteria: [
        'Tickets classified within 30 seconds of submission',
        'P0 tickets routed and escalated immediately',
        'Acknowledgement email sent within 2 minutes',
      ],
      scheduling: { digestEnabled: true, digestCron: '0 9 * * 1-5', digestTimezone: 'America/New_York' },
    },
  },
  {
    slug: 'event-registration',
    name: 'Event Registration',
    category: 'workflow',
    description:
      'Registration form with confirmation emails, automatic waitlist management when capacity is reached, and scheduled reminders before the event.',
    icon: 'CalendarCheck',
    tags: ['events', 'registration', 'waitlist', 'reminders', 'email'],
    estimatedBuildTime: '~2 min',
    fileCount: 10,
    features: [
      'Registration form with capacity tracking',
      'Instant confirmation emails',
      'Automatic waitlist when event is full',
      'Scheduled reminder emails (1 week, 1 day, 1 hour)',
    ],
    brief: {
      name: 'Event Registration',
      audience: 'Event attendees registering for conferences, workshops, or meetups',
      outcome:
        'Collect registrations via form, send confirmation emails, manage waitlist automatically when capacity is reached, and deliver scheduled reminder emails before the event.',
      trigger: 'form_submission',
      fields: [
        { id: 'full_name', label: 'Full Name', type: 'short_text', required: true, options: [] },
        { id: 'email', label: 'Email', type: 'email', required: true, options: [] },
        { id: 'company', label: 'Company / Organization', type: 'short_text', required: false, options: [] },
        { id: 'dietary', label: 'Dietary Restrictions', type: 'select', required: false, options: ['None', 'Vegetarian', 'Vegan', 'Gluten-free', 'Other'] },
        { id: 'tshirt', label: 'T-Shirt Size', type: 'select', required: false, options: ['S', 'M', 'L', 'XL', 'XXL'] },
      ],
      integrations: ['gmail', 'mongodb'],
      auth: 'none',
      persistence: 'mongodb',
      replyStyle: 'warm',
      successCriteria: [
        'Confirmation email sent within 1 minute of registration',
        'Waitlist managed automatically at capacity',
        'Reminder emails delivered on schedule',
      ],
      scheduling: { digestEnabled: true, digestCron: '0 9 * * 1', digestTimezone: 'America/New_York' },
    },
  },
];

// ── Route registrar ────────────────────────────────────────────────────

export async function registerTemplateRoutes(app: FastifyInstance) {
  /**
   * GET /api/templates — returns the full template catalogue.
   */
  app.get('/api/templates', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send(TEMPLATES);
  });

  /**
   * POST /api/templates/:slug/use — creates a new operation pre-populated
   * with the template's brief and persists a workflow intent + project brief
   * in Mongo so the builder picks up where the template left off.
   */
  app.post('/api/templates/:slug/use', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const slug = String((request.params as { slug: string }).slug);
    const template = TEMPLATES.find((t) => t.slug === slug);
    if (!template) {
      return reply.code(404).send({ error: 'template_not_found' });
    }

    // Create a new operation named after the template.
    const opSlug = `${slugify(template.name)}-${nanoid(6).toLowerCase()}`;
    const op = await getPrisma().operation.create({
      data: {
        ownerId: session.userId,
        slug: opSlug,
        name: template.name,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
        status: 'draft',
      },
    });

    // Persist a partial project brief so the scoping panel can pick it up.
    const now = new Date().toISOString();
    const { db } = await getMongo();

    if (template.brief && Object.keys(template.brief).length > 0) {
      await db.collection('project_briefs').insertOne({
        operationId: op.id,
        ownerId: session.userId,
        ...template.brief,
        // Fill required fields the template may not specify.
        name: template.brief.name ?? template.name,
        questionnaireId: `tpl_${nanoid(8)}`,
        generatedAt: now,
        defaulted: template.brief.defaulted ?? [],
        fromTemplate: template.slug,
        persistedAt: now,
      });
    }

    await appendActivity({
      ownerId: session.userId,
      operationId: op.id,
      operationName: op.name,
      kind: 'template_used',
      message: `Created "${op.name}" from the "${template.name}" template.`,
    });

    logger.info(
      { userId: session.userId, operationId: op.id, template: template.slug },
      'operation created from template',
    );

    return reply.code(201).send(op);
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'op';
}
