CREATE TYPE "public"."notification_type" AS ENUM('task_due_soon', 'task_overdue', 'important_deadline', 'study_session_upcoming', 'study_session_missed', 'event_upcoming', 'daily_plan_ready');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"link" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"related_task_id" uuid,
	"related_study_session_id" uuid,
	"related_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_dedupe_key" UNIQUE("user_id","dedupe_key"),
	CONSTRAINT "notifications_title_length" CHECK (char_length("notifications"."title") between 1 and 200),
	CONSTRAINT "notifications_message_length" CHECK (char_length("notifications"."message") between 1 and 500),
	CONSTRAINT "notifications_link_internal" CHECK ("notifications"."link" like '/%' and "notifications"."link" not like '//%')
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "remind_tasks" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "remind_study_sessions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "remind_events" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "remind_overdue" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "remind_daily_plan" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "reminder_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "browser_notifications" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_study_session_id_study_sessions_id_fk" FOREIGN KEY ("related_study_session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_owner_fk" FOREIGN KEY ("related_task_id","user_id") REFERENCES "public"."tasks"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_scheduled_idx" ON "notifications" USING btree ("user_id","scheduled_for");--> statement-breakpoint
ALTER TABLE "student_preferences" ADD CONSTRAINT "student_preferences_reminder_minutes" CHECK ("student_preferences"."reminder_minutes" in (5, 15, 30, 60, 1440));