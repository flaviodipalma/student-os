CREATE TYPE "public"."academic_event_kind" AS ENUM('term', 'no_classes', 'exams', 'deadline', 'other');--> statement-breakpoint
CREATE TABLE "academic_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "academic_event_kind" NOT NULL,
	"title" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"term" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_events_dates" CHECK ("academic_events"."end_date" >= "academic_events"."start_date" and "academic_events"."end_date" - "academic_events"."start_date" <= 400),
	CONSTRAINT "academic_events_title_length" CHECK (char_length(btrim("academic_events"."title")) between 1 and 150),
	CONSTRAINT "academic_events_term_length" CHECK (char_length("academic_events"."term") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "academic_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "academic_events" ADD CONSTRAINT "academic_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academic_events_user_id_idx" ON "academic_events" USING btree ("user_id");