-- updated_at ---------------------------------------------------------------
CREATE TRIGGER "accounts_set_updated_at"
BEFORE UPDATE ON "public"."accounts"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "categories_set_updated_at"
BEFORE UPDATE ON "public"."categories"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "transactions_set_updated_at"
BEFORE UPDATE ON "public"."transactions"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint

-- Categories are two levels deep at most ------------------------------------
CREATE FUNCTION "public"."enforce_category_depth"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
	IF NEW.parent_id IS NOT NULL THEN
		IF EXISTS (
			SELECT 1 FROM "public"."categories" p
			WHERE p.id = NEW.parent_id AND p.parent_id IS NOT NULL
		) THEN
			RAISE EXCEPTION 'Categories can only be two levels deep'
				USING ERRCODE = 'check_violation';
		END IF;
		IF EXISTS (
			SELECT 1 FROM "public"."categories" c WHERE c.parent_id = NEW.id
		) THEN
			RAISE EXCEPTION 'A category with subcategories cannot become a subcategory'
				USING ERRCODE = 'check_violation';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "categories_enforce_depth"
BEFORE INSERT OR UPDATE OF "parent_id" ON "public"."categories"
FOR EACH ROW EXECUTE FUNCTION "public"."enforce_category_depth"();
--> statement-breakpoint

-- A transfer is always exactly one transfer_out and one transfer_in, on two
-- different accounts, and both are deleted or restored together. Checked at
-- commit so the two rows can be written one after the other.
CREATE FUNCTION "public"."check_transfer_group"("g" uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
	n_total integer;
	n_out integer;
	n_in integer;
	n_active integer;
	n_accounts integer;
BEGIN
	IF g IS NULL THEN
		RETURN;
	END IF;
	SELECT
		count(*),
		count(*) FILTER (WHERE type = 'transfer_out'),
		count(*) FILTER (WHERE type = 'transfer_in'),
		count(*) FILTER (WHERE deleted_at IS NULL),
		count(DISTINCT account_id)
	INTO n_total, n_out, n_in, n_active, n_accounts
	FROM "public"."transactions"
	WHERE transfer_group_id = g;

	IF n_total = 0 THEN
		RETURN;
	END IF;
	IF n_out <> 1 OR n_in <> 1 OR n_accounts <> 2 OR n_active NOT IN (0, 2) THEN
		RAISE EXCEPTION 'A transfer needs one outgoing and one incoming transaction on different accounts, deleted or restored together'
			USING ERRCODE = 'check_violation';
	END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "public"."check_transfer_pair"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
	IF TG_OP <> 'DELETE' THEN
		PERFORM "public"."check_transfer_group"(NEW.transfer_group_id);
	END IF;
	IF TG_OP <> 'INSERT' THEN
		PERFORM "public"."check_transfer_group"(OLD.transfer_group_id);
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "transactions_transfer_pair_check"
AFTER INSERT OR UPDATE OR DELETE ON "public"."transactions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."check_transfer_pair"();
--> statement-breakpoint

-- Audit log ----------------------------------------------------------------
-- Runs as the function owner so people cannot write or edit their own history.
-- The actor comes from the app.actor setting (default 'user'); set
-- app.skip_audit to '1' for bulk seeding.
CREATE FUNCTION "public"."audit_row"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	uid uuid;
	rid uuid;
BEGIN
	IF current_setting('app.skip_audit', true) = '1' THEN
		RETURN NULL;
	END IF;
	IF TG_OP = 'DELETE' THEN
		uid := OLD.user_id;
		rid := OLD.id;
	ELSE
		uid := NEW.user_id;
		rid := NEW.id;
	END IF;
	-- When an account is deleted its rows cascade away; nothing to record.
	IF NOT EXISTS (SELECT 1 FROM "auth"."users" u WHERE u.id = uid) THEN
		RETURN NULL;
	END IF;
	INSERT INTO "public"."audit_log"
		("user_id", "table_name", "row_id", "action", "before", "after", "actor")
	VALUES (
		uid,
		TG_TABLE_NAME,
		rid,
		lower(TG_OP),
		CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
		CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
		COALESCE(NULLIF(current_setting('app.actor', true), ''), 'user')
	);
	RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."audit_row"() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER "accounts_audit"
AFTER INSERT OR UPDATE OR DELETE ON "public"."accounts"
FOR EACH ROW EXECUTE FUNCTION "public"."audit_row"();
--> statement-breakpoint
CREATE TRIGGER "categories_audit"
AFTER INSERT OR UPDATE OR DELETE ON "public"."categories"
FOR EACH ROW EXECUTE FUNCTION "public"."audit_row"();
--> statement-breakpoint
CREATE TRIGGER "transactions_audit"
AFTER INSERT OR UPDATE OR DELETE ON "public"."transactions"
FOR EACH ROW EXECUTE FUNCTION "public"."audit_row"();
--> statement-breakpoint

-- Derived balances ----------------------------------------------------------
-- Opening balance plus the account's live transactions. Never stored.
-- security_invoker makes the view obey the caller's row level security.
CREATE VIEW "public"."account_balances" WITH (security_invoker = true) AS
SELECT
	a.id AS account_id,
	a.user_id,
	a.currency,
	(a.opening_balance + COALESCE(SUM(
		CASE t.type
			WHEN 'income' THEN t.amount
			WHEN 'transfer_in' THEN t.amount
			ELSE -t.amount
		END
	), 0))::bigint AS balance,
	COUNT(t.id)::integer AS transaction_count
FROM "public"."accounts" a
LEFT JOIN "public"."transactions" t
	ON t.account_id = a.id AND t.user_id = a.user_id AND t.deleted_at IS NULL
GROUP BY a.id;
--> statement-breakpoint

-- Transfers -----------------------------------------------------------------
-- Writes both sides (and an optional fee) in one call. The client supplies the
-- group id, so retrying the same call cannot create a second transfer.
CREATE FUNCTION "public"."create_transfer"(
	"p_group_id" uuid,
	"p_from_account" uuid,
	"p_to_account" uuid,
	"p_amount_out" bigint,
	"p_amount_in" bigint DEFAULT NULL,
	"p_occurred_at" timestamptz DEFAULT now(),
	"p_note" text DEFAULT NULL,
	"p_fee" bigint DEFAULT NULL,
	"p_fee_category" uuid DEFAULT NULL,
	"p_source" text DEFAULT 'manual'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	cur_from text;
	cur_to text;
	amount_in bigint;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF p_from_account = p_to_account THEN
		RAISE EXCEPTION 'Choose two different accounts' USING ERRCODE = 'check_violation';
	END IF;

	SELECT currency INTO cur_from FROM "public"."accounts"
		WHERE id = p_from_account AND user_id = uid;
	SELECT currency INTO cur_to FROM "public"."accounts"
		WHERE id = p_to_account AND user_id = uid;
	IF cur_from IS NULL OR cur_to IS NULL THEN
		RAISE EXCEPTION 'Account not found' USING ERRCODE = 'no_data_found';
	END IF;

	IF cur_from = cur_to THEN
		amount_in := COALESCE(p_amount_in, p_amount_out);
		IF amount_in <> p_amount_out THEN
			RAISE EXCEPTION 'Both sides of a transfer in the same currency must match'
				USING ERRCODE = 'check_violation';
		END IF;
	ELSE
		IF p_amount_in IS NULL THEN
			RAISE EXCEPTION 'Enter the amount received when the currencies differ'
				USING ERRCODE = 'check_violation';
		END IF;
		amount_in := p_amount_in;
	END IF;

	INSERT INTO "public"."transactions"
		("user_id", "account_id", "type", "amount", "currency", "occurred_at",
		 "note", "transfer_group_id", "source", "idempotency_key")
	VALUES
		(uid, p_from_account, 'transfer_out', p_amount_out, cur_from, p_occurred_at,
		 p_note, p_group_id, p_source, p_group_id::text || ':out'),
		(uid, p_to_account, 'transfer_in', amount_in, cur_to, p_occurred_at,
		 p_note, p_group_id, p_source, p_group_id::text || ':in')
	ON CONFLICT ("user_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL
	DO NOTHING;

	IF p_fee IS NOT NULL AND p_fee > 0 THEN
		INSERT INTO "public"."transactions"
			("user_id", "account_id", "type", "amount", "currency", "occurred_at",
			 "category_id", "note", "source", "idempotency_key")
		VALUES
			(uid, p_from_account, 'expense', p_fee, cur_from, p_occurred_at,
			 p_fee_category, 'Transfer fee', p_source, p_group_id::text || ':fee')
		ON CONFLICT ("user_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL
		DO NOTHING;
	END IF;

	RETURN p_group_id;
END;
$$;
--> statement-breakpoint
-- Soft-deletes or restores both sides of a transfer (and its fee) together.
CREATE FUNCTION "public"."set_transfer_deleted"("p_group_id" uuid, "p_deleted" boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	changed integer;
BEGIN
	UPDATE "public"."transactions"
	SET deleted_at = CASE WHEN p_deleted THEN now() ELSE NULL END
	WHERE user_id = "auth"."uid"()
		AND (transfer_group_id = p_group_id OR idempotency_key = p_group_id::text || ':fee');
	GET DIAGNOSTICS changed = ROW_COUNT;
	RETURN changed;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."create_transfer"(uuid, uuid, uuid, bigint, bigint, timestamptz, text, bigint, uuid, text) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."set_transfer_deleted"(uuid, boolean) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."create_transfer"(uuid, uuid, uuid, bigint, bigint, timestamptz, text, bigint, uuid, text) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."set_transfer_deleted"(uuid, boolean) TO authenticated;
--> statement-breakpoint

-- Starter data for every new user -------------------------------------------
CREATE FUNCTION "public"."seed_user_defaults"("p_user_id" uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
	IF EXISTS (SELECT 1 FROM "public"."categories" WHERE user_id = p_user_id) THEN
		RETURN;
	END IF;
	PERFORM set_config('app.skip_audit', '1', true);

	INSERT INTO "public"."accounts" ("user_id", "name", "type", "sort_order")
	VALUES (p_user_id, 'Cash', 'cash', 0)
	ON CONFLICT DO NOTHING;

	WITH parents (kind, name, icon, color, sort) AS (VALUES
		('expense', 'Food & Dining',   'utensils',       '#e8590c', 0),
		('expense', 'Transport',       'bus',            '#1c7ed6', 1),
		('expense', 'Bills & Utilities','receipt',       '#7048e8', 2),
		('expense', 'Housing',         'house',          '#0ca678', 3),
		('expense', 'Health',          'heart-pulse',    '#e03131', 4),
		('expense', 'Education',       'graduation-cap', '#3b5bdb', 5),
		('expense', 'Shopping',        'shopping-bag',   '#d6336c', 6),
		('expense', 'Entertainment',   'clapperboard',   '#f08c00', 7),
		('expense', 'Family & Gifts',  'gift',           '#c2255c', 8),
		('expense', 'Personal care',   'sparkles',       '#ae3ec9', 9),
		('expense', 'Fees & Charges',  'landmark',       '#495057', 10),
		('expense', 'Other',           'ellipsis',       '#868e96', 11),
		('income',  'Salary',          'briefcase',      '#2f9e44', 0),
		('income',  'Business income', 'store',          '#099268', 1),
		('income',  'Gifts received',  'gift',           '#c2255c', 2),
		('income',  'Interest & investments', 'trending-up', '#1098ad', 3),
		('income',  'Other income',    'ellipsis',       '#868e96', 4)
	), inserted AS (
		INSERT INTO "public"."categories" ("user_id", "name", "kind", "icon", "color", "sort_order")
		SELECT p_user_id, name, kind, icon, color, sort FROM parents
		RETURNING id, name, kind
	), subs (parent, kind, name, sort) AS (VALUES
		('Food & Dining',   'expense', 'Groceries', 0),
		('Food & Dining',   'expense', 'Restaurants & chop bars', 1),
		('Food & Dining',   'expense', 'Snacks & drinks', 2),
		('Transport',       'expense', 'Fuel', 0),
		('Transport',       'expense', 'Ride-hailing', 1),
		('Transport',       'expense', 'Trotro & bus fare', 2),
		('Transport',       'expense', 'Car maintenance', 3),
		('Bills & Utilities','expense', 'Electricity', 0),
		('Bills & Utilities','expense', 'Water', 1),
		('Bills & Utilities','expense', 'Internet & data', 2),
		('Bills & Utilities','expense', 'Airtime', 3),
		('Bills & Utilities','expense', 'TV & subscriptions', 4),
		('Housing',         'expense', 'Rent', 0),
		('Housing',         'expense', 'Repairs & maintenance', 1),
		('Health',          'expense', 'Medical', 0),
		('Health',          'expense', 'Pharmacy', 1),
		('Education',       'expense', 'School fees', 0),
		('Education',       'expense', 'Books & supplies', 1),
		('Shopping',        'expense', 'Clothing', 0),
		('Shopping',        'expense', 'Household items', 1),
		('Shopping',        'expense', 'Electronics', 2),
		('Fees & Charges',  'expense', 'Bank charges', 0),
		('Fees & Charges',  'expense', 'Mobile money fees', 1)
	)
	INSERT INTO "public"."categories" ("user_id", "name", "kind", "parent_id", "sort_order")
	SELECT p_user_id, s.name, s.kind, i.id, s.sort
	FROM subs s
	JOIN inserted i ON i.name = s.parent AND i.kind = s.kind;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."seed_user_defaults"(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- New sign-ups get a profile and the starter data.
CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
	INSERT INTO "public"."profiles" ("user_id", "display_name")
	VALUES (NEW.id, NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''))
	ON CONFLICT ("user_id") DO NOTHING;
	PERFORM "public"."seed_user_defaults"(NEW.id);
	RETURN NEW;
END;
$$;
--> statement-breakpoint
-- People who signed up before this migration get the starter data too.
SELECT "public"."seed_user_defaults"(user_id) FROM "public"."profiles";
