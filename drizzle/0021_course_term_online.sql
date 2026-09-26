ALTER TABLE "courses" ADD COLUMN "term_start" date;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "term_end" date;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "online" boolean DEFAULT false NOT NULL;