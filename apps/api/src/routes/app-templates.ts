import type { FastifyInstance } from 'fastify';
import { requireSession } from '../plugins/auth-plugin.js';

/**
 * Full App Templates — not prototypes, not demos, FULL production apps.
 *
 * Each template is a detailed GPT-5.5 prompt that generates a complete
 * full-stack application (30-60 files). Unlike Lovable's templates which
 * are React-only scaffolds, these produce:
 *   - Fastify backend with auth, validation, rate limiting
 *   - MongoDB with typed schemas and indexes
 *   - React frontend with Tailwind, components, routing
 *   - Tests, README, .env.example, Dockerfile
 *   - Email templates and notification system
 *   - Background jobs and scheduling
 *
 * The templates feed into the standard build pipeline:
 *   Architect → Builder → Quality Gate → Security → Verifier → Test → Deploy
 */

interface AppTemplate {
  slug: string;
  name: string;
  category: 'saas' | 'marketplace' | 'social' | 'productivity' | 'ai-native' | 'internal';
  description: string;
  icon: string;
  estimatedFiles: number;
  estimatedBuildTime: string;
  features: string[];
  techHighlights: string[];
  /** The full prompt sent to GPT-5.5 — this IS the template */
  buildPrompt: string;
}

const FULL_APP_TEMPLATES: AppTemplate[] = [
  {
    slug: 'saas-dashboard',
    name: 'SaaS Dashboard',
    category: 'saas',
    description: 'Complete SaaS with user auth, team management, billing, analytics dashboard, and settings. Production-ready from day one.',
    icon: 'BarChart3',
    estimatedFiles: 45,
    estimatedBuildTime: '3-5 min',
    features: [
      'Magic-link authentication with session management',
      'Team/workspace management with invite system',
      'Role-based access control (owner, admin, member)',
      'Analytics dashboard with charts and KPIs',
      'Billing integration ready (Stripe-compatible)',
      'User settings with profile, notifications, security',
      'Activity feed and audit log',
      'Dark mode with system preference detection',
    ],
    techHighlights: [
      'Fastify + Zod validation',
      'MongoDB with typed schemas',
      'React + Tailwind + Framer Motion',
      'Tanstack Query for server state',
      'react-hook-form with Zod resolvers',
    ],
    buildPrompt: `Build a complete SaaS dashboard application — the kind of tool a B2B startup ships as their core product. This is NOT a prototype. This is a production-ready application with real auth, real data, real UI.

## Pages (minimum 8)

1. **Login** — Magic-link email input, clean minimal design
2. **Dashboard** — 4 KPI cards at top (total users, active today, revenue this month, growth %), followed by a line chart (last 30 days activity), recent activity table
3. **Team** — Member list with avatar, name, email, role badge, joined date. Invite button opens a modal with email input. Role selector dropdown (owner/admin/member).
4. **Settings > Profile** — Name, email, avatar upload, timezone selector
5. **Settings > Notifications** — Toggle switches for email notifications, weekly digest, team alerts
6. **Settings > Security** — Active sessions list with device/browser/IP, "Revoke all" button
7. **Settings > Billing** — Current plan card, usage meter, upgrade CTA, invoice history table
8. **Activity** — Filterable, paginated activity log with timestamp, actor, action, target

## Data Model

- User: id, email, name, avatarUrl, timezone, role, createdAt, lastLoginAt
- Team: id, name, slug, ownerId, createdAt
- TeamMember: id, teamId, userId, role (owner/admin/member), invitedAt, joinedAt
- Activity: id, teamId, actorId, action, target, metadata, createdAt
- Session: id, userId, tokenHash, device, browser, ip, createdAt, expiresAt

## API Routes (minimum 15)

- Auth: POST /auth/magic-link, GET /auth/callback, POST /auth/logout, GET /auth/me
- Team: GET /api/team, POST /api/team/invite, PATCH /api/team/members/:id, DELETE /api/team/members/:id
- Users: GET /api/users/me, PATCH /api/users/me, GET /api/users/sessions, DELETE /api/users/sessions/:id
- Dashboard: GET /api/dashboard/stats, GET /api/dashboard/chart
- Activity: GET /api/activity
- Settings: GET /api/settings, PATCH /api/settings

## Design

Dark mode by default. Color scheme: deep navy background (#0a0f1a), cyan accent (#00e5cc), white text. Inter font. 4px spacing grid. Sidebar navigation on desktop, bottom nav on mobile. Cards with subtle borders and glass effect. Charts use recharts or a custom SVG. Tables are sortable with hover states. All forms use react-hook-form with inline validation. Loading states use skeleton shimmers. Empty states have an icon, message, and CTA.`,
  },
  {
    slug: 'ai-chat-app',
    name: 'AI Chat Application',
    category: 'ai-native',
    description: 'Full-stack AI chat app with streaming responses, conversation history, model selection, and a beautiful chat interface.',
    icon: 'MessageSquare',
    estimatedFiles: 40,
    estimatedBuildTime: '3-4 min',
    features: [
      'Streaming AI responses with real-time typing effect',
      'Conversation history with search and delete',
      'Multiple AI model selection (GPT-5.5, GPT-4o, Claude)',
      'System prompt customization per conversation',
      'Code block syntax highlighting in responses',
      'Copy message, regenerate response buttons',
      'Token usage tracking per conversation',
      'Mobile-responsive chat interface',
    ],
    techHighlights: [
      'Server-Sent Events for streaming',
      'OpenAI API with model routing',
      'Markdown rendering with code blocks',
      'Prism.js syntax highlighting',
      'Conversation state in MongoDB',
    ],
    buildPrompt: `Build a complete AI chat application — like ChatGPT but self-hosted and customizable. Full-stack with streaming, history, and a professional chat UI.

## Pages

1. **Chat** — Main chat interface. Left sidebar with conversation list (title, last message preview, date). Main area with message bubbles (user = right-aligned, AI = left-aligned with avatar). Input box at bottom with send button and model selector dropdown. Streaming responses show a cursor animation.
2. **Settings** — API key management (masked input), default model selector, default system prompt textarea, theme toggle
3. **History** — Searchable, filterable list of all conversations with word count, token count, model used

## Data Model

- Conversation: id, userId, title, model, systemPrompt, messageCount, totalTokens, createdAt, updatedAt
- Message: id, conversationId, role (user/assistant/system), content, model, promptTokens, completionTokens, createdAt

## Critical Features

- Streaming: Use Server-Sent Events. The backend calls the OpenAI streaming API and forwards chunks to the frontend via SSE. The frontend renders each chunk immediately with a typing effect.
- Markdown: AI responses render as formatted markdown with code blocks. Code blocks have a "Copy" button and syntax highlighting via Prism.js or highlight.js.
- Model routing: Support GPT-5.5, GPT-4o, GPT-4o-mini. Read API key from env. Use max_completion_tokens (NOT max_tokens) for GPT-5.5. Do NOT pass temperature for GPT-5.5.

## Design

Dark theme. Chat bubbles: user messages have a subtle cyan background (#00e5cc/10), AI messages have a dark surface (#1a1f2e). Monospace font for code blocks. Inter for everything else. Smooth scroll-to-bottom on new messages. Sidebar collapses on mobile.`,
  },
  {
    slug: 'project-management',
    name: 'Project Management Tool',
    category: 'productivity',
    description: 'Kanban board with drag-and-drop, project views, task management, team assignment, and deadline tracking.',
    icon: 'Kanban',
    estimatedFiles: 42,
    estimatedBuildTime: '4-5 min',
    features: [
      'Kanban board with drag-and-drop columns',
      'List view and calendar view',
      'Task creation with title, description, assignee, due date, priority, labels',
      'Project management with team assignment',
      'Due date tracking with overdue warnings',
      'Search and filter tasks across projects',
      'Activity timeline per task',
      'Keyboard shortcuts (N for new task, / for search)',
    ],
    techHighlights: [
      'Drag-and-drop via @dnd-kit',
      'Multiple view modes (kanban, list, calendar)',
      'Optimistic updates with Tanstack Query',
      'Real-time updates via Socket.io',
      'Keyboard navigation system',
    ],
    buildPrompt: `Build a complete project management tool — like a simplified Linear or Trello. Full-stack with real drag-and-drop, multiple views, and team features.

## Pages

1. **Projects** — Grid of project cards with name, description, member avatars, task count, progress bar. "New Project" button.
2. **Board** (Kanban) — Columns: To Do, In Progress, In Review, Done. Cards show title, assignee avatar, priority badge, due date. Drag cards between columns. Click card to open detail panel.
3. **List** — Table view: checkbox, title, status (badge), assignee, priority, due date, labels. Sortable columns. Bulk actions (move, assign, delete).
4. **Task Detail** — Side panel or modal: title (editable), description (markdown editor), status selector, assignee selector, priority (urgent/high/medium/low), due date picker, labels, activity timeline, comments.
5. **Settings** — Project name, description, members, labels management, archive project.

## Data Model

- Project: id, name, description, ownerId, members[], labels[], createdAt
- Task: id, projectId, title, description, status, assigneeId, priority, dueDate, labels[], position (for ordering), createdAt, updatedAt
- Comment: id, taskId, authorId, content, createdAt
- Activity: id, taskId, actorId, action, details, createdAt

## Design

Clean, minimal. White/light gray background (#f8f9fa). Accent: indigo (#6366f1). Cards have subtle shadow on hover. Priority badges: urgent=red, high=orange, medium=yellow, low=gray. Status badges: todo=gray, in-progress=blue, review=purple, done=green. Smooth drag animations. Keyboard-first design — / opens search, N opens new task.`,
  },
  {
    slug: 'marketplace',
    name: 'Digital Marketplace',
    category: 'marketplace',
    description: 'Two-sided marketplace with listings, search, user profiles, messaging, and reviews. Sellers list products, buyers purchase.',
    icon: 'Store',
    estimatedFiles: 50,
    estimatedBuildTime: '5-6 min',
    features: [
      'Product listings with images, pricing, categories',
      'Full-text search with filters (category, price range, rating)',
      'Seller profiles with rating and review history',
      'Buyer/seller messaging system',
      'Review and rating system (1-5 stars with text)',
      'Shopping cart and checkout flow',
      'Order management for sellers',
      'Responsive product grid and detail pages',
    ],
    techHighlights: [
      'Full-text search with MongoDB text indexes',
      'Image upload and preview',
      'Star rating component',
      'Cart state management',
      'Order lifecycle state machine',
    ],
    buildPrompt: `Build a complete digital marketplace — like a simplified Gumroad or Etsy for digital products. Two-sided: sellers list products, buyers browse and purchase.

## Pages

1. **Home** — Hero section, featured products grid, category navigation, search bar
2. **Browse** — Product grid with sidebar filters (category, price range, rating, sort). Infinite scroll or pagination. Each card: image, title, price, seller name, rating stars.
3. **Product Detail** — Large image gallery, title, description (markdown), price, seller info card, "Buy Now" button, reviews section with average rating and individual reviews.
4. **Seller Dashboard** — My listings (table: title, price, sales, revenue, status), "Add Listing" button, order management, earnings summary.
5. **Add/Edit Listing** — Form: title, description (rich text), price, category selector, image upload (drag-drop), tags.
6. **Cart** — Item list with quantity, subtotal per item, total, "Checkout" button.
7. **Profile** — User info, listings (if seller), purchase history (if buyer), reviews given/received.
8. **Messages** — Conversation list, message thread, "Contact Seller" from product page.

## Data Model

- User: id, email, name, avatarUrl, bio, isSeller, rating, reviewCount, createdAt
- Product: id, sellerId, title, description, price, category, images[], tags[], status (draft/active/sold), salesCount, rating, reviewCount, createdAt
- Order: id, buyerId, sellerId, productId, amount, status (pending/completed/refunded), createdAt
- Review: id, productId, authorId, rating (1-5), text, createdAt
- Message: id, senderId, receiverId, productId?, content, readAt, createdAt
- Cart: id, userId, items: [{productId, quantity}]

## Design

Light theme with warm accents. Primary: deep purple (#7c3aed). Cards with rounded corners and subtle shadows. Product images should have a 4:3 aspect ratio container. Price displayed in bold. Rating shows filled/empty stars. Search has a prominent, centered design. Mobile: products in a 2-column grid.`,
  },
  {
    slug: 'crm-platform',
    name: 'CRM Platform',
    category: 'saas',
    description: 'Customer relationship management with contacts, deals pipeline, email tracking, tasks, and reporting.',
    icon: 'Users',
    estimatedFiles: 48,
    estimatedBuildTime: '4-5 min',
    features: [
      'Contact management with custom fields',
      'Deals pipeline with drag-and-drop stages',
      'Email tracking and logging',
      'Task management per contact/deal',
      'Reporting dashboard with conversion metrics',
      'Import/export contacts (CSV)',
      'Activity timeline per contact',
      'Search and filter across all entities',
    ],
    techHighlights: [
      'Pipeline visualization with drag-and-drop',
      'CSV parser for import',
      'Full-text search across contacts',
      'Metric calculations and charts',
      'Activity feed aggregation',
    ],
    buildPrompt: `Build a complete CRM platform — like a simplified HubSpot or Pipedrive. Full contact management, deal pipeline, and reporting.

## Pages

1. **Dashboard** — KPI cards (total contacts, open deals, deal value, conversion rate), pipeline summary chart, recent activity, upcoming tasks
2. **Contacts** — Sortable table: name, company, email, phone, last contacted, status (lead/prospect/customer/churned). Search bar. Filters. "Add Contact" button. Click row → detail view.
3. **Contact Detail** — Profile card (name, company, email, phone, custom fields), deal history, activity timeline, tasks, notes. Edit inline.
4. **Deals** — Pipeline view: columns for each stage (Lead, Qualified, Proposal, Negotiation, Won, Lost). Cards show deal name, value, contact, expected close date. Drag between stages.
5. **Deal Detail** — Value, stage, contact link, probability %, expected close date, notes, activity log
6. **Tasks** — Task list with due date, priority, associated contact/deal, status. "Add Task" button.
7. **Reports** — Pipeline conversion funnel, deals won/lost over time chart, revenue forecast, top contacts by deal value
8. **Settings** — Custom pipeline stages, custom contact fields, CSV import/export

## Data Model

- Contact: id, name, email, phone, company, position, status, customFields{}, source, createdAt, lastContactedAt
- Deal: id, contactId, name, value, stage, probability, expectedCloseDate, notes, ownerId, createdAt, updatedAt
- Task: id, contactId?, dealId?, title, description, dueDate, priority, completed, createdAt
- Activity: id, contactId?, dealId?, type (call/email/meeting/note), content, createdAt
- Note: id, contactId?, dealId?, content, authorId, createdAt

## Design

Professional, clean. Light background. Primary blue (#2563eb). Pipeline columns with colored headers matching stage. Deal cards show value prominently. Contact avatars use initials with random pastel backgrounds. Tables have sticky headers. Charts use a consistent blue color palette.`,
  },
];

export async function registerAppTemplateRoutes(app: FastifyInstance) {
  /** GET /api/app-templates — List all full app templates. */
  app.get('/api/app-templates', async (request_obj, reply) => {
    const session = requireSession(request_obj, reply);
    if (!session) return;

    return reply.send({
      templates: FULL_APP_TEMPLATES.map((t) => ({
        slug: t.slug,
        name: t.name,
        category: t.category,
        description: t.description,
        icon: t.icon,
        estimatedFiles: t.estimatedFiles,
        estimatedBuildTime: t.estimatedBuildTime,
        features: t.features,
        techHighlights: t.techHighlights,
      })),
    });
  });

  /** GET /api/app-templates/:slug — Get a template's full build prompt. */
  app.get('/api/app-templates/:slug', async (request_obj, reply) => {
    const session = requireSession(request_obj, reply);
    if (!session) return;

    const slug = String((request_obj.params as { slug: string }).slug);
    const template = FULL_APP_TEMPLATES.find((t) => t.slug === slug);
    if (!template) return reply.code(404).send({ error: 'template_not_found' });

    return reply.send(template);
  });
}
