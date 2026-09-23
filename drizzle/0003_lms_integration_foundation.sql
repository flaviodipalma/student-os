CREATE TYPE "public"."lms_connection_status" AS ENUM('connected', 'needs_reauth', 'error');--> statement-breakpoint
CREATE TYPE "public"."lms_provider" AS ENUM('canvas', 'blackboard');--> statement-breakpoint
CREATE TABLE "lms_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "lms_provider" NOT NULL,
	"external_user_id" text,
	"base_url" text,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"status" "lms_connection_status" DEFAULT 'connected' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lms_connections_user_provider_key" UNIQUE("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "lms_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "external_source" "lms_provider";--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "external_synced" jsonb;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "external_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_source" "lms_provider";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_synced" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "external_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lms_connections" ADD CONSTRAINT "lms_connections_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_user_external_key" UNIQUE("user_id","external_source","external_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_external_key" UNIQUE("user_id","external_source","external_id");--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_external_pair" CHECK (("courses"."external_source" is null) = ("courses"."external_id" is null));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_external_pair" CHECK (("tasks"."external_source" is null) = ("tasks"."external_id" is null));