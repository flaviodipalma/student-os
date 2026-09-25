ALTER TYPE "public"."lms_connection_method" ADD VALUE 'extension';--> statement-breakpoint
CREATE TABLE "extension_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_tokens_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "extension_tokens_name_length" CHECK (char_length(btrim("extension_tokens"."name")) between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "extension_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "extension_tokens" ADD CONSTRAINT "extension_tokens_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_tokens_user_idx" ON "extension_tokens" USING btree ("user_id");