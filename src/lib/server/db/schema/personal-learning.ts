import { check, index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';

export type LearningSnapshot = {
  version: 1;
  goal: string;
  studyDays: number;
  sessions: Array<{
    index: number;
    title: string;
    lesson: string;
    activityMinutes: number;
    sources: Array<{ id?: string; url: string; name: string; retrievedAt: string; relationship: string }>;
  }>;
};

export type LearningSessionSource = { id?: string; url: string; name: string; retrievedAt: string; relationship: string };

export const learningConversation = pgTable('learning_conversation', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerUserId: text('owner_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  goal: text('goal').notNull(),
  language: text('language').notNull(),
  priorKnowledge: text('prior_knowledge').notNull(),
  offerStatus: text('offer_status').notNull().default('not_offered'),
  consentGoal: text('consent_goal'),
  consentStudyDays: integer('consent_study_days'),
  consentDailyMinutes: integer('consent_daily_minutes'),
  consentedAt: timestamp('consented_at'),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, (table) => [
  check('learning_conversation_offer_status_check', sql`${table.offerStatus} in ('not_offered', 'offered', 'dismissed', 'accepted')`),
  check('learning_conversation_days_check', sql`${table.consentStudyDays} is null or ${table.consentStudyDays} in (1, 7, 30)`),
  check('learning_conversation_minutes_check', sql`${table.consentDailyMinutes} is null or ${table.consentDailyMinutes} in (30, 60, 120)`)
]);

export const learningJourney = pgTable('learning_journey', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerUserId: text('owner_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').references(() => learningConversation.id, { onDelete: 'set null' }).unique(),
  goal: text('goal').notNull(),
  studyDays: integer('study_days').notNull(),
  dailyMinutes: integer('daily_minutes').notNull(),
  status: text('status').notNull().default('sourcing'),
  searchesUsed: integer('searches_used').notNull().default(0),
  sourcePagesUsed: integer('source_pages_used').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, (table) => [
  check('learning_journey_days_check', sql`${table.studyDays} in (1, 7, 30)`),
  check('learning_journey_minutes_check', sql`${table.dailyMinutes} in (30, 60, 120)`),
  check('learning_journey_status_check', sql`${table.status} in ('sourcing', 'generating', 'ready', 'failed')`),
  check('learning_journey_source_quota_check', sql`${table.searchesUsed} between 0 and 5 and ${table.sourcePagesUsed} between 0 and 10`)
]);

export const learningSession = pgTable('learning_session', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  journeyId: text('journey_id').notNull().references(() => learningJourney.id, { onDelete: 'cascade' }),
  sessionIndex: integer('session_index').notNull(),
  status: text('status').notNull().default('queued'),
  title: text('title'),
  activityMinutes: integer('activity_minutes'),
  sourceManifest: jsonb('source_manifest').$type<LearningSessionSource[]>().notNull().default([]),
  lesson: text('lesson'),
  sourceUrl: text('source_url'),
  generationPromptVersion: text('generation_prompt_version'),
  generationModelId: text('generation_model_id'),
  generatedAt: timestamp('generated_at'),
  generationFailure: text('generation_failure'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, (table) => [
  unique('learning_session_journey_index_unique').on(table.journeyId, table.sessionIndex),
  check('learning_session_index_check', sql`${table.sessionIndex} >= 1`),
  check('learning_session_status_check', sql`${table.status} in ('queued', 'generating', 'ready', 'failed')`),
  check('learning_session_ready_check', sql`${table.status} <> 'ready' or (${table.title} is not null and ${table.lesson} is not null and ${table.activityMinutes} is not null and jsonb_array_length(${table.sourceManifest}) > 0)`)
]);

export const learningChatTurn = pgTable('learning_chat_turn', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().references(() => learningSession.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, (table) => [
  index('learning_chat_turn_session_created_at_idx').on(table.sessionId, table.createdAt)
]);

export const learningJobOutbox = pgTable('learning_job_outbox', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().references(() => learningSession.id, { onDelete: 'cascade' }).unique(),
  jobKey: text('job_key').notNull().unique(),
  status: text('status').notNull().default('queued'),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, (table) => [
  check('learning_job_outbox_status_check', sql`${table.status} in ('queued', 'enqueued', 'complete', 'failed')`)
]);

export const learningShare = pgTable('learning_share', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerUserId: text('owner_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  journeyId: text('journey_id').notNull().references(() => learningJourney.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  snapshot: jsonb('snapshot').$type<LearningSnapshot>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at')
});

export const learningForkLineage = pgTable('learning_fork_lineage', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  journeyId: text('journey_id').notNull().references(() => learningJourney.id, { onDelete: 'cascade' }).unique(),
  sourceShareId: text('source_share_id').notNull().references(() => learningShare.id, { onDelete: 'restrict' }),
  ownerUserId: text('owner_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  forkKey: text('fork_key').notNull()
}, (table) => [
  unique('learning_fork_request_unique').on(table.sourceShareId, table.ownerUserId, table.forkKey)
]);
