CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid,
	"category_kind" text DEFAULT 'expense' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'GHS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_kind_chk" CHECK ("budgets"."category_kind" = 'expense'),
	CONSTRAINT "budgets_amount_chk" CHECK ("budgets"."amount" > 0 and "budgets"."amount" <= 99999999999999),
	CONSTRAINT "budgets_currency_chk" CHECK ("budgets"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_fk" FOREIGN KEY ("category_id","user_id","category_kind") REFERENCES "public"."categories"("id","user_id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_user_category_uq" ON "budgets" USING btree ("user_id",coalesce("category_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE POLICY "budgets_select_own" ON "budgets" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("budgets"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "budgets_insert_own" ON "budgets" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("budgets"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "budgets_update_own" ON "budgets" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("budgets"."user_id" = (select auth.uid())) WITH CHECK ("budgets"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "budgets_delete_own" ON "budgets" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("budgets"."user_id" = (select auth.uid()));