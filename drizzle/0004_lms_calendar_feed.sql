CREATE TYPE "public"."lms_connection_method" AS ENUM('oauth', 'calendar_feed');--> statement-breakpoint
ALTER TABLE "lms_connections" ADD COLUMN "method" "lms_connection_method" DEFAULT 'oauth' NOT NULL;--> statement-breakpoint
ALTER TABLE "lms_connections" ADD COLUMN "feed_url_encrypted" text;