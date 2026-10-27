CREATE TABLE "learning_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"goal" text NOT NULL,
	"language" text NOT NULL,
	"prior_knowledge" text NOT NULL,
	"offer_status" text DEFAULT 'not_offered' NOT NULL,
	"consent_goal" text,
	"consent_study_days" integer,
	"consent_daily_minutes" integer,
	"consented_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learning_conversation_offer_status_check" CHECK ("learning_conversation"."offer_status" in ('not_offered', 'offered', 'dismissed', 'accepted')),
	CONSTRAINT "learning_conversation_days_check" CHECK ("learning_conversation"."consent_study_days" is null or "learning_conversation"."consent_study_days" in (1, 7, 30)),
	CONSTRAINT "learning_conversation_minutes_check" CHECK ("learning_conversation"."consent_daily_minutes" is null or "learning_conversation"."consent_daily_minutes" in (30, 60, 120))
);
--> statement-breakpoint
CREATE TABLE "learning_job_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"job_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learning_job_outbox_session_id_unique" UNIQUE("session_id"),
	CONSTRAINT "learning_job_outbox_job_key_unique" UNIQUE("job_key"),
	CONSTRAINT "learning_job_outbox_status_check" CHECK ("learning_job_outbox"."status" in ('queued', 'enqueued', 'complete', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "learning_journey" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"goal" text NOT NULL,
	"study_days" integer NOT NULL,
	"daily_minutes" integer NOT NULL,
	"status" text DEFAULT 'sourcing' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learning_journey_conversation_id_unique" UNIQUE("conversation_id"),
	CONSTRAINT "learning_journey_days_check" CHECK ("learning_journey"."study_days" in (1, 7, 30)),
	CONSTRAINT "learning_journey_minutes_check" CHECK ("learning_journey"."daily_minutes" in (30, 60, 120)),
	CONSTRAINT "learning_journey_status_check" CHECK ("learning_journey"."status" in ('sourcing', 'generating', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "learning_session" (
	"id" text PRIMARY KEY NOT NULL,
	"journey_id" text NOT NULL,
	"session_index" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lesson" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learning_session_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "learning_session_journey_index_unique" UNIQUE("journey_id","session_index"),
	CONSTRAINT "learning_session_index_check" CHECK ("learning_session"."session_index" >= 1),
	CONSTRAINT "learning_session_status_check" CHECK ("learning_session"."status" in ('queued', 'generating', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "learning_conversation" ADD CONSTRAINT "learning_conversation_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_job_outbox" ADD CONSTRAINT "learning_job_outbox_session_id_learning_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_journey" ADD CONSTRAINT "learning_journey_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_journey" ADD CONSTRAINT "learning_journey_conversation_id_learning_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."learning_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_session" ADD CONSTRAINT "learning_session_journey_id_learning_journey_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."learning_journey"("id") ON DELETE cascade ON UPDATE no action;