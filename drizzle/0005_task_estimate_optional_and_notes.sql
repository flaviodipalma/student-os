ALTER TABLE "tasks" ALTER COLUMN "estimated_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "notes" text DEFAULT '' NOT NULL;