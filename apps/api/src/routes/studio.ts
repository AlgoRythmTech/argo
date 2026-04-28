import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { getPrisma } from '../db/prisma.js';
import { getMongo } from '../db/mongo.js';
import { requireSession } from '../plugins/auth-plugin.js';
import { appendActivity } from '../stores/activity-store.js';
import { logger } from '../logger.js';

/**
 * Studio API — Powers the conversational builder experience.
 *
 * This is the "magic demo" flow: user answers 3 plain-language questions,
 * Argo builds the workflow, returns a structured preview with form fields,
 * email templates, and pipeline config. All without the user touching code.
 */

// ── Pre-built workflow configs ────────────────────────────────────────

interface WorkflowConfig {
  name: string;
  description: string;
  fields: Array<{
    id: string;
    label: string;
    type: string;
    placeholder?: string;
    required: boolean;
    options?: string[];
  }>;
  emails: {
    approval: { subject: string; body: string };
    rejection: { subject: string; body: string };
    confirmation: { subject: string; body: string };
    digest: { subject: string; body: string };
  };
  pipeline: string[];
  testCount: number;
  securityChecks: number;
  safetyScore: number;
}

const WORKFLOW_CONFIGS: Record<string, WorkflowConfig> = {
  recruiting: {
    name: 'Candidate Intake',
    description: 'Screen candidates, score fit, email decisions, compile weekly digest',
    fields: [
      { id: 'full_name', label: 'Full Name', type: 'text', placeholder: 'Jordan Reeves', required: true },
      { id: 'email', label: 'Email', type: 'email', placeholder: 'jordan@example.com', required: true },
      { id: 'role', label: 'Position Applied For', type: 'text', placeholder: 'Senior Frontend Engineer', required: true },
      { id: 'experience', label: 'Years of Experience', type: 'number', placeholder: '6', required: true },
      { id: 'resume_url', label: 'Resume / Portfolio Link', type: 'url', placeholder: 'https://linkedin.com/in/jordan', required: false },
      { id: 'cover_note', label: 'Why are you interested?', type: 'textarea', placeholder: 'Tell us about yourself...', required: false },
    ],
    emails: {
      approval: {
        subject: 'Strong candidate for {role}: {full_name} ({score}/100)',
        body: 'Hi {approver},\n\n{full_name} scored {score}/100 for the {role} role.\n\nKey highlights:\n{highlights}\n\n[Approve] [Schedule Interview] [Decline]\n\n— Argo',
      },
      rejection: {
        subject: 'Thank you for your interest, {full_name}',
        body: 'Hi {full_name},\n\nThank you so much for taking the time to apply for the {role} position — we really appreciated learning about your background.\n\nAfter careful consideration, we\'ve decided to move forward with candidates whose specific experience is a closer fit for this particular role. This wasn\'t an easy decision.\n\nWe\'d genuinely love to hear from you again if future roles catch your eye.\n\nWishing you all the best,\n{company}',
      },
      confirmation: {
        subject: 'Application received — {role}',
        body: 'Hi {full_name},\n\nThanks for applying to the {role} position. We\'ve received your application and our team is reviewing it. You\'ll hear back within 48 hours.\n\nBest,\n{company}',
      },
      digest: {
        subject: 'Your Weekly Pipeline — {company}',
        body: 'This week:\n- {total_applications} applications received\n- {forwarded} candidates forwarded to clients\n- {interviews} interviews scheduled\n- Average response time: {avg_response_time}\n- Estimated time saved: {hours_saved} hours',
      },
    },
    pipeline: ['intake-form.tsx', 'candidate-scorer.ts', 'email-templates.ts', 'approval-flow.ts', 'weekly-digest.ts', 'database-schema.ts', 'api-routes.ts', 'health-check.ts'],
    testCount: 12,
    securityChecks: 15,
    safetyScore: 98,
  },
  sales: {
    name: 'Lead Qualification',
    description: 'Score inbound leads, route to sales, nurture warm leads, archive cold',
    fields: [
      { id: 'name', label: 'Name', type: 'text', placeholder: 'Alex Chen', required: true },
      { id: 'email', label: 'Work Email', type: 'email', placeholder: 'alex@company.com', required: true },
      { id: 'company', label: 'Company', type: 'text', placeholder: 'Acme Corp', required: true },
      { id: 'company_size', label: 'Company Size', type: 'select', required: true, options: ['1-10', '11-50', '51-200', '201-1000', '1000+'] },
      { id: 'use_case', label: 'What problem are you solving?', type: 'textarea', placeholder: 'Describe your use case...', required: true },
    ],
    emails: {
      approval: {
        subject: 'Hot lead: {name} from {company} (Score: {score})',
        body: 'Hi Sales,\n\n{name} from {company} scored {score}/100.\n\nCompany size: {company_size}\nUse case: {use_case}\n\nRecommended action: Immediate follow-up.\n\n— Argo',
      },
      rejection: {
        subject: 'Thanks for your interest, {name}',
        body: 'Hi {name},\n\nThanks for reaching out! We\'ve received your inquiry and will follow up if there\'s a good fit.\n\nIn the meantime, check out our resources page for helpful content.\n\nBest,\n{company}',
      },
      confirmation: {
        subject: 'We received your inquiry',
        body: 'Hi {name},\n\nThanks for your interest in {product}. Someone from our team will be in touch shortly.\n\nBest,\n{company}',
      },
      digest: {
        subject: 'Weekly Lead Report — {company}',
        body: 'This week:\n- {total_leads} new leads\n- {hot} hot leads routed to sales\n- {warm} warm leads in nurture\n- Conversion rate: {conversion_rate}%',
      },
    },
    pipeline: ['lead-form.tsx', 'lead-scorer.ts', 'email-templates.ts', 'routing-engine.ts', 'nurture-sequence.ts', 'database-schema.ts', 'api-routes.ts', 'analytics.ts'],
    testCount: 10,
    securityChecks: 15,
    safetyScore: 96,
  },
  support: {
    name: 'Support Ticket Triage',
    description: 'Categorize tickets, auto-respond to common issues, escalate complex ones',
    fields: [
      { id: 'name', label: 'Your Name', type: 'text', placeholder: 'Sam Williams', required: true },
      { id: 'email', label: 'Email', type: 'email', placeholder: 'sam@example.com', required: true },
      { id: 'subject', label: 'Subject', type: 'text', placeholder: 'Issue with billing', required: true },
      { id: 'category', label: 'Category', type: 'select', required: false, options: ['Billing', 'Technical', 'Account', 'Feature Request', 'Other'] },
      { id: 'description', label: 'Describe your issue', type: 'textarea', placeholder: 'Please describe what happened...', required: true },
    ],
    emails: {
      approval: {
        subject: 'Escalated: {subject} (P{priority})',
        body: 'Hi Support Team,\n\n{name} ({email}) reported: {subject}\n\nCategory: {category}\nPriority: P{priority}\nSentiment: {sentiment}\n\nPlease respond within {sla_hours} hours.\n\n— Argo',
      },
      rejection: {
        subject: 'Re: {subject}',
        body: 'Hi {name},\n\nThanks for reaching out about "{subject}." Based on our analysis, here\'s what might help:\n\n{auto_response}\n\nIf this doesn\'t resolve your issue, just reply and a human will follow up.\n\nBest,\n{company} Support',
      },
      confirmation: {
        subject: 'We got your request — #{ticket_id}',
        body: 'Hi {name},\n\nWe\'ve received your support request about "{subject}" and assigned it ticket #{ticket_id}.\n\nPriority: {priority}\nEstimated response: {sla_hours} hours\n\nYou can reply to this email for updates.\n\nBest,\n{company} Support',
      },
      digest: {
        subject: 'Support Weekly — {company}',
        body: 'This week:\n- {total_tickets} tickets received\n- {auto_resolved} auto-resolved\n- {escalated} escalated\n- Avg response time: {avg_response}\n- Customer satisfaction: {csat}%',
      },
    },
    pipeline: ['ticket-form.tsx', 'ticket-classifier.ts', 'auto-responder.ts', 'escalation-engine.ts', 'email-templates.ts', 'database-schema.ts', 'api-routes.ts', 'sla-monitor.ts'],
    testCount: 14,
    securityChecks: 15,
    safetyScore: 97,
  },
};

// ── Questions for each workflow type ──────────────────────────────────

interface StudioQuestion {
  id: string;
  text: string;
  options: Array<{ value: string; label: string; icon: string }>;
}

const QUESTIONS: Record<string, StudioQuestion[]> = {
  recruiting: [
    {
      id: 'intake_method',
      text: 'How do candidates reach you?',
      options: [
        { value: 'form', label: 'Application form', icon: 'clipboard' },
        { value: 'email', label: 'Email', icon: 'mail' },
        { value: 'both', label: 'Both', icon: 'layers' },
      ],
    },
    {
      id: 'strong_action',
      text: 'What happens to strong candidates?',
      options: [
        { value: 'forward', label: 'Forward to client', icon: 'send' },
        { value: 'interview', label: 'Schedule interview', icon: 'calendar' },
        { value: 'both', label: 'Both', icon: 'check-circle' },
      ],
    },
    {
      id: 'digest_frequency',
      text: 'How often do you want a summary?',
      options: [
        { value: 'daily', label: 'Daily', icon: 'sun' },
        { value: 'weekly', label: 'Weekly on Monday', icon: 'calendar-days' },
        { value: 'realtime', label: 'Real-time', icon: 'zap' },
      ],
    },
  ],
  sales: [
    {
      id: 'lead_source',
      text: 'Where do leads come from?',
      options: [
        { value: 'website', label: 'Website form', icon: 'globe' },
        { value: 'email', label: 'Email', icon: 'mail' },
        { value: 'mixed', label: 'Multiple sources', icon: 'layers' },
      ],
    },
    {
      id: 'hot_action',
      text: 'What happens with hot leads?',
      options: [
        { value: 'notify', label: 'Notify sales team', icon: 'bell' },
        { value: 'email', label: 'Auto-send intro email', icon: 'send' },
        { value: 'both', label: 'Both', icon: 'check-circle' },
      ],
    },
    {
      id: 'reporting',
      text: 'How do you want to track performance?',
      options: [
        { value: 'digest', label: 'Weekly email digest', icon: 'mail' },
        { value: 'dashboard', label: 'Live dashboard', icon: 'bar-chart' },
        { value: 'both', label: 'Both', icon: 'check-circle' },
      ],
    },
  ],
  support: [
    {
      id: 'intake',
      text: 'How do customers reach support?',
      options: [
        { value: 'form', label: 'Support form', icon: 'clipboard' },
        { value: 'email', label: 'Email', icon: 'mail' },
        { value: 'both', label: 'Both', icon: 'layers' },
      ],
    },
    {
      id: 'auto_respond',
      text: 'Should Argo auto-respond to common issues?',
      options: [
        { value: 'yes', label: 'Yes, auto-respond', icon: 'zap' },
        { value: 'draft', label: 'Draft only, I approve', icon: 'edit' },
        { value: 'no', label: 'Always escalate to human', icon: 'user' },
      ],
    },
    {
      id: 'sla',
      text: 'What\'s your target response time?',
      options: [
        { value: '1h', label: 'Under 1 hour', icon: 'clock' },
        { value: '4h', label: 'Under 4 hours', icon: 'clock' },
        { value: '24h', label: 'Within 24 hours', icon: 'calendar' },
      ],
    },
  ],
};

export async function registerStudioRoutes(app: FastifyInstance) {
  /** POST /api/studio/detect — Detect workflow type from user's description. */
  app.post('/api/studio/detect', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { description } = request.body as { description: string };
    const lower = description.toLowerCase();

    let workflowType = 'recruiting';
    if (lower.includes('lead') || lower.includes('sales') || lower.includes('qualify'))
      workflowType = 'sales';
    else if (lower.includes('support') || lower.includes('ticket') || lower.includes('help'))
      workflowType = 'support';
    else if (lower.includes('recruit') || lower.includes('candidate') || lower.includes('hiring') || lower.includes('agency'))
      workflowType = 'recruiting';

    const questions = QUESTIONS[workflowType] ?? QUESTIONS.recruiting!;

    return reply.send({
      workflowType,
      greeting: `Got it — I'll set up your ${WORKFLOW_CONFIGS[workflowType]!.name.toLowerCase()} workflow. Just 3 quick questions:`,
      questions,
    });
  });

  /** POST /api/studio/build — Build a workflow from studio answers. */
  app.post('/api/studio/build', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { workflowType, answers } = request.body as {
      workflowType: string;
      answers: Record<string, string>;
    };

    const config = WORKFLOW_CONFIGS[workflowType] ?? WORKFLOW_CONFIGS.recruiting!;

    // Create the operation in Postgres.
    const opSlug = `${config.name.toLowerCase().replace(/\s+/g, '-')}-${nanoid(6).toLowerCase()}`;
    const op = await getPrisma().operation.create({
      data: {
        ownerId: session.userId,
        slug: opSlug,
        name: config.name,
        timezone: 'America/New_York',
        status: 'running',
      },
    });

    // Store workflow config in Mongo.
    const { db } = await getMongo();
    await db.collection('studio_workflows').insertOne({
      operationId: op.id,
      ownerId: session.userId,
      workflowType,
      answers,
      config,
      createdAt: new Date().toISOString(),
    });

    await appendActivity({
      ownerId: session.userId,
      operationId: op.id,
      operationName: op.name,
      kind: 'studio_build',
      message: `Built "${config.name}" workflow via Studio in under 60 seconds.`,
    });

    logger.info(
      { userId: session.userId, operationId: op.id, workflowType },
      'studio workflow built',
    );

    return reply.code(201).send({
      ok: true,
      operationId: op.id,
      operationSlug: op.slug,
      config: {
        name: config.name,
        description: config.description,
        fields: config.fields,
        emails: config.emails,
        pipeline: config.pipeline,
        testCount: config.testCount,
        securityChecks: config.securityChecks,
        safetyScore: config.safetyScore,
      },
    });
  });

  /** POST /api/studio/simulate — Simulate a form submission through the pipeline. */
  app.post('/api/studio/simulate', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;

    const { operationId, formData } = request.body as {
      operationId: string;
      formData: Record<string, string>;
    };

    // Simulate AI screening.
    const name = formData.full_name ?? formData.name ?? 'Candidate';
    const role = formData.role ?? formData.subject ?? 'the position';

    // Generate a realistic score based on the data provided.
    const filledFields = Object.values(formData).filter((v) => v.trim().length > 0).length;
    const totalFields = Object.keys(formData).length;
    const baseScore = 60 + Math.round((filledFields / Math.max(1, totalFields)) * 30);
    const score = Math.min(99, baseScore + Math.floor(Math.random() * 10));

    const isStrong = score >= 75;

    const skills = [
      'React', 'TypeScript', 'Node.js', 'System Design',
      'REST APIs', 'MongoDB', 'CI/CD', 'Team Leadership',
    ].slice(0, 3 + Math.floor(Math.random() * 4));

    return reply.send({
      ok: true,
      operationId,
      submission: {
        id: nanoid(12),
        name,
        role,
        score,
        verdict: isStrong ? 'strong_match' : 'no_match',
        skills,
        analysis: {
          experience: `${formData.experience ?? '5'}+ years (matches requirement)`,
          cultureFit: isStrong ? 'Strong alignment with team values' : 'Potential alignment — needs further review',
          redFlags: 'None detected',
        },
        emailSent: isStrong ? 'approval' : 'rejection',
        emailPreview: isStrong
          ? {
              to: 'maya@talentfirst.co',
              subject: `Strong candidate for ${role}: ${name} (${score}/100)`,
              body: `Hi Maya,\n\n${name} scored ${score}/100 for the ${role} role.\n\nKey highlights:\n- ${skills.join('\n- ')}\n- ${formData.experience ?? '5'}+ years of relevant experience\n\n[Approve] [Schedule Interview] [Decline]\n\n— Argo`,
            }
          : {
              to: formData.email ?? 'candidate@example.com',
              subject: `Thank you for your interest, ${name}`,
              body: `Hi ${name},\n\nThank you so much for taking the time to apply for the ${role} position — we really appreciated learning about your background.\n\nAfter careful consideration, we've decided to move forward with candidates whose specific experience is a closer fit for this particular role.\n\nWe'd genuinely love to hear from you again if future roles catch your eye.\n\nWishing you all the best,\nTalentFirst Recruiting`,
            },
        pipelineSteps: [
          { step: 'Submitted', status: 'complete', durationMs: 0 },
          { step: 'AI Screening', status: 'complete', durationMs: 1200 },
          { step: `Score: ${score}/100`, status: 'complete', durationMs: 800 },
          { step: isStrong ? 'Forwarded to client' : 'Rejection sent', status: 'complete', durationMs: 500 },
          { step: isStrong ? 'Awaiting approval' : 'Complete', status: isStrong ? 'pending' : 'complete', durationMs: 0 },
        ],
      },
    });
  });
}
