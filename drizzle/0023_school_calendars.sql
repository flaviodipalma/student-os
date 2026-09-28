CREATE TYPE "public"."school_calendar_status" AS ENUM('found', 'not_found');--> statement-breakpoint
CREATE TABLE "school_calendars" (
	"domain" text PRIMARY KEY NOT NULL,
	"status" "school_calendar_status" NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" text[] DEFAULT '{}' NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_calendars_domain_format" CHECK ("school_calendars"."domain" ~ '^[a-z0-9.-]+\.[a-z]{2,}$')
);
--> statement-breakpoint
ALTER TABLE "school_calendars" ENABLE ROW LEVEL SECURITY;