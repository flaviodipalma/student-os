CREATE TABLE "external_calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "lms_provider" NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text,
	"url" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_calendar_events_user_source_key" UNIQUE("user_id","source","external_id"),
	CONSTRAINT "external_calendar_events_end_after_start" CHECK ("external_calendar_events"."ends_at" > "external_calendar_events"."starts_at"),
	CONSTRAINT "external_calendar_events_title_length" CHECK (char_length(btrim("external_calendar_events"."title")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "external_calendar_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_calendar_events" ADD CONSTRAINT "external_calendar_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_calendar_events_user_starts_idx" ON "external_calendar_events" USING btree ("user_id","starts_at");