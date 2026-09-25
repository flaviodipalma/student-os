ALTER TABLE "profiles" DROP CONSTRAINT "profiles_academic_term_length";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "academic_term";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "academic_year";--> statement-breakpoint
DROP TYPE "public"."academic_year";