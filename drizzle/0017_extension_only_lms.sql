-- The browser extension is now the only way to connect Canvas and Blackboard.
-- Calendar-link and sign-in (OAuth) connections are removed; imported courses and
-- tasks stay. Their calendar events (only the calendar links brought any) stop
-- showing, as when disconnecting. Then the columns that held their secrets go.
UPDATE "external_calendar_events" SET "removed_at" = now() WHERE "source" IN ('canvas', 'blackboard') AND "removed_at" IS NULL;--> statement-breakpoint
DELETE FROM "lms_connections" WHERE "method" <> 'extension';--> statement-breakpoint
ALTER TABLE "lms_connections" ALTER COLUMN "method" SET DEFAULT 'extension';--> statement-breakpoint
ALTER TABLE "lms_connections" DROP COLUMN "external_user_id";--> statement-breakpoint
ALTER TABLE "lms_connections" DROP COLUMN "access_token_encrypted";--> statement-breakpoint
ALTER TABLE "lms_connections" DROP COLUMN "refresh_token_encrypted";--> statement-breakpoint
ALTER TABLE "lms_connections" DROP COLUMN "feed_url_encrypted";--> statement-breakpoint
ALTER TABLE "lms_connections" DROP COLUMN "token_expires_at";