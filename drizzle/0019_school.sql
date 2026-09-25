ALTER TABLE "profiles" ADD COLUMN "school_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "school_domain" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_school_name_length" CHECK (char_length("profiles"."school_name") <= 200);--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_school_domain_format" CHECK ("profiles"."school_domain" is null or (char_length("profiles"."school_domain") <= 253 and "profiles"."school_domain" ~ '^[a-z0-9.-]+\.[a-z]{2,}$'));