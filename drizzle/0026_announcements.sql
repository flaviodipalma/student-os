CREATE TYPE "public"."announcement_finding_kind" AS ENUM('exam', 'quiz', 'deadline', 'no_class');--> statement-breakpoint
CREATE TYPE "public"."announcement_finding_status" AS ENUM('pending', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."class_cancellation_source" AS ENUM('announcement', 'calendar');--> statement-breakpoint
ALTER TYPE "public"."external_calendar_source" ADD VALUE 'brightspace';--> statement-breakpoint
CREATE TABLE "announcement_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"announcement_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"kind" "announcement_finding_kind" NOT NULL,
	"title" text NOT NULL,
	"date" date NOT NULL,
	"time" time,
	"quote" text,
	"status" "announcement_finding_status" DEFAULT 'pending' NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_findings_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "announcement_findings_title_length" CHECK (char_length(btrim("announcement_findings"."title")) between 1 and 200),
	CONSTRAINT "announcement_findings_quote_length" CHECK ("announcement_findings"."quote" is null or char_length("announcement_findings"."quote") <= 500)
);
--> statement-breakpoint
ALTER TABLE "announcement_findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "class_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"date" date NOT NULL,
	"source" "class_cancellation_source" NOT NULL,
	"finding_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_cancellations_user_course_date_key" UNIQUE("user_id","course_id","date")
);
--> statement-breakpoint
ALTER TABLE "class_cancellations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lms_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "lms_provider" NOT NULL,
	"external_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"posted_at" timestamp with time zone,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lms_announcements_user_external_key" UNIQUE("user_id","provider","external_id"),
	CONSTRAINT "lms_announcements_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "lms_announcements_title_length" CHECK (char_length("lms_announcements"."title") <= 300)
);
--> statement-breakpoint
ALTER TABLE "lms_announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "announcement_findings" ADD CONSTRAINT "announcement_findings_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_findings" ADD CONSTRAINT "announcement_findings_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_findings" ADD CONSTRAINT "announcement_findings_announcement_fk" FOREIGN KEY ("announcement_id","user_id") REFERENCES "public"."lms_announcements"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_findings" ADD CONSTRAINT "announcement_findings_course_fk" FOREIGN KEY ("course_id","user_id") REFERENCES "public"."courses"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_cancellations" ADD CONSTRAINT "class_cancellations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_cancellations" ADD CONSTRAINT "class_cancellations_finding_id_announcement_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."announcement_findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_cancellations" ADD CONSTRAINT "class_cancellations_course_fk" FOREIGN KEY ("course_id","user_id") REFERENCES "public"."courses"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lms_announcements" ADD CONSTRAINT "lms_announcements_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lms_announcements" ADD CONSTRAINT "lms_announcements_course_fk" FOREIGN KEY ("course_id","user_id") REFERENCES "public"."courses"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_findings_user_status_idx" ON "announcement_findings" USING btree ("user_id","status");