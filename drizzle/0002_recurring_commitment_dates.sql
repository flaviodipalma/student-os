ALTER TABLE "recurring_commitments" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "recurring_commitments" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "recurring_commitments" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "recurring_commitments" ADD CONSTRAINT "recurring_commitments_dates" CHECK ("recurring_commitments"."end_date" is null or "recurring_commitments"."start_date" is null or "recurring_commitments"."end_date" >= "recurring_commitments"."start_date");--> statement-breakpoint
ALTER TABLE "recurring_commitments" ADD CONSTRAINT "recurring_commitments_description_length" CHECK (char_length("recurring_commitments"."description") <= 500);