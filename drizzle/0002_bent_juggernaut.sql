CREATE TABLE "learning_fork_lineage" (
	"id" text PRIMARY KEY NOT NULL,
	"journey_id" text NOT NULL,
	"source_share_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"fork_key" text NOT NULL,
	CONSTRAINT "learning_fork_lineage_journey_id_unique" UNIQUE("journey_id"),
	CONSTRAINT "learning_fork_request_unique" UNIQUE("source_share_id","owner_user_id","fork_key")
);
--> statement-breakpoint
CREATE TABLE "learning_share" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"journey_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "learning_share_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "learning_journey" DROP CONSTRAINT "learning_journey_conversation_id_learning_conversation_id_fk";
--> statement-breakpoint
ALTER TABLE "learning_journey" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_session" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "learning_session" ADD COLUMN "activity_minutes" integer;--> statement-breakpoint
ALTER TABLE "learning_fork_lineage" ADD CONSTRAINT "learning_fork_lineage_journey_id_learning_journey_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."learning_journey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_fork_lineage" ADD CONSTRAINT "learning_fork_lineage_source_share_id_learning_share_id_fk" FOREIGN KEY ("source_share_id") REFERENCES "public"."learning_share"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_fork_lineage" ADD CONSTRAINT "learning_fork_lineage_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_share" ADD CONSTRAINT "learning_share_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_share" ADD CONSTRAINT "learning_share_journey_id_learning_journey_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."learning_journey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_journey" ADD CONSTRAINT "learning_journey_conversation_id_learning_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."learning_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_session" ADD CONSTRAINT "learning_session_ready_check" CHECK ("learning_session"."status" <> 'ready' or ("learning_session"."title" is not null and "learning_session"."lesson" is not null and "learning_session"."activity_minutes" is not null and jsonb_array_length("learning_session"."source_manifest") > 0));