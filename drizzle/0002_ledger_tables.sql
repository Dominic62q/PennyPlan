CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"currency" text DEFAULT 'GHS' NOT NULL,
	"opening_balance" bigint DEFAULT 0 NOT NULL,
	"opening_date" date DEFAULT current_date NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"credit_limit" bigint,
	"statement_day" smallint,
	"due_day" smallint,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_id_user_currency_uq" UNIQUE("id","user_id","currency"),
	CONSTRAINT "accounts_name_chk" CHECK (char_length(btrim("accounts"."name")) between 1 and 60),
	CONSTRAINT "accounts_type_chk" CHECK ("accounts"."type" in ('cash','bank','savings','credit_card','mobile_money','investment','loan')),
	CONSTRAINT "accounts_currency_chk" CHECK ("accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "accounts_opening_balance_chk" CHECK (abs("accounts"."opening_balance") <= 99999999999999),
	CONSTRAINT "accounts_statement_day_chk" CHECK ("accounts"."statement_day" between 1 and 31),
	CONSTRAINT "accounts_due_day_chk" CHECK ("accounts"."due_day" between 1 and 31)
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"icon" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_id_user_kind_uq" UNIQUE("id","user_id","kind"),
	CONSTRAINT "categories_name_chk" CHECK (char_length(btrim("categories"."name")) between 1 and 60),
	CONSTRAINT "categories_kind_chk" CHECK ("categories"."kind" in ('income','expense'))
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category_id" uuid,
	"category_kind" text GENERATED ALWAYS AS (case when type = 'income' then 'income' when type = 'expense' then 'expense' end) STORED,
	"payee" text,
	"note" text,
	"status" text DEFAULT 'cleared' NOT NULL,
	"transfer_group_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"idempotency_key" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_type_chk" CHECK ("transactions"."type" in ('expense','income','transfer_out','transfer_in')),
	CONSTRAINT "transactions_amount_chk" CHECK ("transactions"."amount" > 0 and "transactions"."amount" <= 99999999999999),
	CONSTRAINT "transactions_currency_chk" CHECK ("transactions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "transactions_status_chk" CHECK ("transactions"."status" in ('pending','cleared','reconciled')),
	CONSTRAINT "transactions_source_chk" CHECK ("transactions"."source" in ('manual','import','recurring','assistant')),
	CONSTRAINT "transactions_transfer_group_chk" CHECK (("transactions"."type" in ('transfer_out','transfer_in')) = ("transactions"."transfer_group_id" is not null)),
	CONSTRAINT "transactions_transfer_no_category_chk" CHECK ("transactions"."type" not in ('transfer_out','transfer_in') or "transactions"."category_id" is null),
	CONSTRAINT "transactions_payee_chk" CHECK (char_length("transactions"."payee") <= 120),
	CONSTRAINT "transactions_note_chk" CHECK (char_length("transactions"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"actor" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_action_chk" CHECK ("audit_log"."action" in ('insert','update','delete')),
	CONSTRAINT "audit_log_actor_chk" CHECK ("audit_log"."actor" in ('user','assistant','import','recurring'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("parent_id","user_id","kind") REFERENCES "public"."categories"("id","user_id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_fk" FOREIGN KEY ("account_id","user_id","currency") REFERENCES "public"."accounts"("id","user_id","currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_fk" FOREIGN KEY ("category_id","user_id","category_kind") REFERENCES "public"."categories"("id","user_id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_name_uq" ON "accounts" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_kind_parent_name_uq" ON "categories" USING btree ("user_id","kind",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_user_idempotency_uq" ON "transactions" USING btree ("user_id","idempotency_key") WHERE "transactions"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "transactions_user_occurred_idx" ON "transactions" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_user_account_occurred_idx" ON "transactions" USING btree ("user_id","account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_user_category_occurred_idx" ON "transactions" USING btree ("user_id","category_id","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_transfer_group_idx" ON "transactions" USING btree ("transfer_group_id") WHERE "transactions"."transfer_group_id" is not null;--> statement-breakpoint
CREATE INDEX "audit_log_user_created_idx" ON "audit_log" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_user_row_idx" ON "audit_log" USING btree ("user_id","table_name","row_id");--> statement-breakpoint
CREATE POLICY "accounts_select_own" ON "accounts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("accounts"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "accounts_insert_own" ON "accounts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("accounts"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "accounts_update_own" ON "accounts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("accounts"."user_id" = (select auth.uid())) WITH CHECK ("accounts"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "accounts_delete_own" ON "accounts" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("accounts"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "categories_select_own" ON "categories" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("categories"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "categories_insert_own" ON "categories" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("categories"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "categories_update_own" ON "categories" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("categories"."user_id" = (select auth.uid())) WITH CHECK ("categories"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "categories_delete_own" ON "categories" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("categories"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "transactions_select_own" ON "transactions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("transactions"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "transactions_insert_own" ON "transactions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("transactions"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "transactions_update_own" ON "transactions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("transactions"."user_id" = (select auth.uid())) WITH CHECK ("transactions"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "transactions_delete_own" ON "transactions" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("transactions"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "audit_log_select_own" ON "audit_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("audit_log"."user_id" = (select auth.uid()));