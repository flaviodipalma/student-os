ALTER TABLE "student_preferences" ADD COLUMN "learn_estimates" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "learn_study_times" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "learn_workload" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "planning_mode" text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "preferred_periods" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "dismissed_patterns" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "own_estimate_task_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "student_preferences" ADD CONSTRAINT "student_preferences_planning_mode" CHECK ("student_preferences"."planning_mode" in ('balanced', 'deadline-focus', 'exam-focus', 'light-day', 'custom'));--> statement-breakpoint
ALTER TABLE "student_preferences" ADD CONSTRAINT "student_preferences_preferred_periods" CHECK ("student_preferences"."preferred_periods" <@ array['morning', 'afternoon', 'evening', 'night']::text[]);--> statement-breakpoint
ALTER TABLE "student_preferences" ADD CONSTRAINT "student_preferences_personalization_sizes" CHECK (cardinality("student_preferences"."dismissed_patterns") <= 50 and cardinality("student_preferences"."own_estimate_task_ids") <= 500);