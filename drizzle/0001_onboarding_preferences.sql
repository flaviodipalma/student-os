CREATE TYPE "public"."academic_year" AS ENUM('freshman', 'sophomore', 'junior', 'senior', 'graduate', 'other');--> statement-breakpoint
CREATE TABLE "recurring_commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"days_of_week" smallint[] NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"type" "event_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_commitments_end_after_start" CHECK ("recurring_commitments"."end_time" > "recurring_commitments"."start_time"),
	CONSTRAINT "recurring_commitments_title_length" CHECK (char_length(btrim("recurring_commitments"."title")) between 1 and 100),
	CONSTRAINT "recurring_commitments_days" CHECK (cardinality("recurring_commitments"."days_of_week") between 1 and 7 and "recurring_commitments"."days_of_week" <@ array[0,1,2,3,4,5,6]::smallint[])
);
--> statement-breakpoint
ALTER TABLE "recurring_commitments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "student_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"study_start" time NOT NULL,
	"study_end" time NOT NULL,
	"max_study_minutes_per_day" integer NOT NULL,
	"preferred_block_minutes" integer NOT NULL,
	"break_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_preferences_window" CHECK ("student_preferences"."study_end" > "student_preferences"."study_start"),
	CONSTRAINT "student_preferences_max_study" CHECK ("student_preferences"."max_study_minutes_per_day" between 15 and 720),
	CONSTRAINT "student_preferences_block" CHECK ("student_preferences"."preferred_block_minutes" in (30, 45, 60, 90)),
	CONSTRAINT "student_preferences_break" CHECK ("student_preferences"."break_minutes" between 0 and 60)
);
--> statement-breakpoint
ALTER TABLE "student_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "academic_term" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "academic_year" "academic_year";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "onboarding_completed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_commitments" ADD CONSTRAINT "recurring_commitments_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD CONSTRAINT "student_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_commitments_user_id_idx" ON "recurring_commitments" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_last_name_length" CHECK (char_length("profiles"."last_name") <= 80);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_academic_term_length" CHECK (char_length("profiles"."academic_term") <= 60);