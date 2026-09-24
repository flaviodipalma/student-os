ALTER TABLE "student_preferences" ADD COLUMN "adaptive_planning" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "adaptive_since" date;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "reschedule_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "first_date" date;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD COLUMN "first_start_time" time;