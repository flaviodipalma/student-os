CREATE TYPE "public"."theme_preference" AS ENUM('light', 'dark', 'system');--> statement-breakpoint
ALTER TABLE "student_preferences" ADD COLUMN "theme" "theme_preference";