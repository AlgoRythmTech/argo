import { api } from './client.js';

export type QuestionKind =
  | 'single_choice'
  | 'multi_choice'
  | 'short_text'
  | 'long_text'
  | 'numeric'
  | 'pick_one_of_recommended';

export interface QuestionOption {
  id: string;
  label: string;
  hint?: string;
  recommended?: boolean;
}

export interface ScopingQuestion {
  id: string;
  prompt: string;
  helper?: string;
  kind: QuestionKind;
  options: QuestionOption[];
  placeholder?: string;
  required: boolean;
  briefField: string;
}

export interface ScopingQuestionnaire {
  id: string;
  rawSentence: string;
  detectedSummary: string;
  specialist: string;
  questions: ScopingQuestion[];
  createdAt: string;
}

export interface QuestionAnswer {
  questionId: string;
  selectedOptionIds: string[];
  textValue?: string;
}

export interface QuestionnaireSubmission {
  questionnaireId: string;
  answers: QuestionAnswer[];
}

export interface ProjectBrief {
  name: string;
  audience: string;
  outcome: string;
  trigger: 'form_submission' | 'email_received' | 'scheduled' | 'webhook';
  fields: Array<{ id: string; label: string; type: string; required: boolean; options: string[] }>;
  integrations: string[];
  auth: string;
  persistence: string;
  rateLimits: { formPerMinutePerIp: number; webhookPerMinutePerIp: number };
  dataClassification: string;
  successCriteria: string[];
  voiceTone?: string;
  replyStyle: string;
  scheduling: { digestEnabled: boolean; digestCron: string; digestTimezone: string };
  notificationRecipients: string[];
  complianceNotes?: string;
  freeForm?: string;
  defaulted: string[];
  questionnaireId: string;
  generatedAt: string;
}

export interface RefinementResult {
  refined: boolean;
  refinementSummary: string;
  /** When refined=true, the new follow-up questionnaire to ask. */
  questionnaire?: ScopingQuestionnaire;
  /** Per-question explanation of why the LLM asked it. */
  rationales?: Array<{ questionId: string; rationale: string }>;
  /** Set when the upstream refinement service errored — UI degrades gracefully. */
  warning?: string;
}

export const scoping = {
  start: (operationId: string, sentence: string) =>
    api.post<ScopingQuestionnaire>('/api/scoping/start', { operationId, sentence }),
  /**
   * Optional second-round refinement. Submit the operator's first-round
   * answers; the LLM either returns a follow-up questionnaire (refined:true)
   * or signals the brief is already crisp enough to finalise.
   */
  refine: (operationId: string, submission: QuestionnaireSubmission) =>
    api.post<RefinementResult>('/api/scoping/refine', { operationId, submission }),
  finalize: (operationId: string, submission: QuestionnaireSubmission) =>
    api.post<{ ok: true; brief: ProjectBrief; buildPrompt: string }>('/api/scoping/finalize', {
      operationId,
      submission,
    }),
  latest: (operationId: string) =>
    api.get<ProjectBrief & { buildPrompt: string }>(`/api/scoping/${operationId}/latest`),
};
