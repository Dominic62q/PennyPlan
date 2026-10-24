CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"category_kind" text GENERATED ALWAYS AS (kind) STORED,
	"frequency" text NOT NULL,
	"repeat_every" smallint DEFAULT 1 NOT NULL,
	"anchor_day" smallint NOT NULL,
	"next_due" date NOT NULL,
	"end_date" date,
	"auto_post" boolean DEFAULT false NOT NULL,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_rules_kind_chk" CHECK ("recurring_rules"."kind" in ('expense','income')),
	CONSTRAINT "recurring_rules_name_chk" CHECK (char_length(btrim("recurring_rules"."name")) between 1 and 60),
	CONSTRAINT "recurring_rules_amount_chk" CHECK ("recurring_rules"."amount" > 0 and "recurring_rules"."amount" <= 99999999999999),
	CONSTRAINT "recurring_rules_currency_chk" CHECK ("recurring_rules"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "recurring_rules_frequency_chk" CHECK ("recurring_rules"."frequency" in ('weekly','monthly','yearly')),
	CONSTRAINT "recurring_rules_every_chk" CHECK ("recurring_rules"."repeat_every" between 1 and 12),
	CONSTRAINT "recurring_rules_anchor_chk" CHECK ("recurring_rules"."anchor_day" between 1 and 31)
);
--> statement-breakpoint
ALTER TABLE "recurring_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_account_fk" FOREIGN KEY ("account_id","user_id","currency") REFERENCES "public"."accounts"("id","user_id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_category_fk" FOREIGN KEY ("category_id","user_id","category_kind") REFERENCES "public"."categories"("id","user_id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_rules_user_due_idx" ON "recurring_rules" USING btree ("user_id","next_due");--> statement-breakpoint
CREATE POLICY "recurring_rules_select_own" ON "recurring_rules" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("recurring_rules"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "recurring_rules_insert_own" ON "recurring_rules" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("recurring_rules"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "recurring_rules_update_own" ON "recurring_rules" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("recurring_rules"."user_id" = (select auth.uid())) WITH CHECK ("recurring_rules"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "recurring_rules_delete_own" ON "recurring_rules" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("recurring_rules"."user_id" = (select auth.uid()));