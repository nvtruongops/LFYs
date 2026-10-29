CREATE TABLE "learning_chat_turn" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learning_chat_turn" ADD CONSTRAINT "learning_chat_turn_session_id_learning_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_chat_turn_session_created_at_idx" ON "learning_chat_turn" USING btree ("session_id","created_at");