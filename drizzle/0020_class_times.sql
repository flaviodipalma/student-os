ALTER TABLE "recurring_commitments" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_commitments" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "recurring_commitments" ADD CONSTRAINT "recurring_commitments_course_owner_fk" FOREIGN KEY ("course_id","user_id") REFERENCES "public"."courses"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_commitments_course_id_idx" ON "recurring_commitments" USING btree ("course_id");--> statement-breakpoint
ALTER TABLE "recurring_commitments" ADD CONSTRAINT "recurring_commitments_class_times" CHECK ("recurring_commitments"."course_id" is null or "recurring_commitments"."type" = 'class');--> statement-breakpoint
ALTER TABLE "recurring_commitments" ADD CONSTRAINT "recurring_commitments_location_length" CHECK (char_length("recurring_commitments"."location") between 1 and 100);