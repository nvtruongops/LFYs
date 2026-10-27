ALTER TABLE "learning_journey" ADD COLUMN "searches_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_journey" ADD COLUMN "source_pages_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_session" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "learning_session" ADD COLUMN "generation_prompt_version" text;--> statement-breakpoint
ALTER TABLE "learning_session" ADD COLUMN "generation_model_id" text;--> statement-breakpoint
ALTER TABLE "learning_session" ADD COLUMN "generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "learning_session" ADD COLUMN "generation_failure" text;--> statement-breakpoint
ALTER TABLE "learning_journey" ADD CONSTRAINT "learning_journey_source_quota_check" CHECK ("learning_journey"."searches_used" between 0 and 5 and "learning_journey"."source_pages_used" between 0 and 10);