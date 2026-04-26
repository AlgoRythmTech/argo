import { AgentMailService } from './agentmail.js';
import { MailpitService } from './mailpit.js';
import type { EmailAutomationService } from './service.js';

/**
 * Factory: production AgentMail when AGENTMAIL_ENABLED=true, otherwise
 * Mailpit. Per Section 13: never to SendGrid, Postmark, Resend, etc.
 */
export function createEmailAutomationService(): EmailAutomationService {
  const enabled = process.env.AGENTMAIL_ENABLED?.toLowerCase() === 'true';
  if (!enabled) return MailpitService.fromEnv();
  return AgentMailService.fromEnv();
}
