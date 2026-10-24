CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text,
	"base_currency" text DEFAULT 'GHS' NOT NULL,
	"locale" text DEFAULT 'en-GH' NOT NULL,
	"timezone" text DEFAULT 'Africa/Accra' NOT NULL,
	"week_start" smallint DEFAULT 1 NOT NULL,
	"month_start_day" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "profiles_base_currency_chk" CHECK ("profiles"."base_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "profiles_week_start_chk" CHECK ("profiles"."week_start" between 0 and 6),
	CONSTRAINT "profiles_month_start_day_chk" CHECK ("profiles"."month_start_day" between 1 and 28)
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "profiles_select_own" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("profiles"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profiles_insert_own" ON "profiles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("profiles"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "profiles_update_own" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("profiles"."user_id" = (select auth.uid())) WITH CHECK ("profiles"."user_id" = (select auth.uid()));