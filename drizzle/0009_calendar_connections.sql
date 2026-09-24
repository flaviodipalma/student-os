CREATE TYPE "public"."calendar_provider" AS ENUM('google', 'outlook');--> statement-breakpoint
CREATE TYPE "public"."external_calendar_source" AS ENUM('canvas', 'blackboard', 'google', 'outlook');--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "calendar_provider" NOT NULL,
	"external_account_id" text,
	"account_email" text,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text,
	"status" "lms_connection_status" DEFAULT 'connected' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_connections_user_provider_key" UNIQUE("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "calendar_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_calendar_events" ALTER COLUMN "source" SET DATA TYPE "public"."external_calendar_source" USING "source"::text::"public"."external_calendar_source";--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;