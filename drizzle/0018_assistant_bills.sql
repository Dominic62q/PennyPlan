-- Bills changed by the assistant ----------------------------------------------------
-- Same pattern as the rest: runs as the person, tags audit rows 'assistant',
-- hands back an undo token (the audit row of the bill itself). Messages raised
-- here are written for people.

CREATE FUNCTION "public"."assistant_create_bill"(
	"p_id" uuid,
	"p_kind" text,
	"p_name" text,
	"p_amount" bigint,
	"p_account" uuid,
	"p_category" uuid,
	"p_frequency" text,
	"p_every" integer,
	"p_first_due" date,
	"p_end" date DEFAULT NULL,
	"p_auto" boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	nm text := btrim(p_name);
	cur text;
	token uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF nm IS NULL OR char_length(nm) NOT BETWEEN 1 AND 60 THEN
		RAISE EXCEPTION 'Use a name of 1 to 60 characters.';
	END IF;
	IF p_kind NOT IN ('expense', 'income') THEN
		RAISE EXCEPTION 'A bill is either an expense or income.';
	END IF;
	IF p_amount IS NULL OR p_amount < 1 OR p_amount > 99999999999999 THEN
		RAISE EXCEPTION 'That amount is out of range.';
	END IF;
	IF p_frequency NOT IN ('weekly', 'monthly', 'yearly') OR p_every NOT BETWEEN 1 AND 12 THEN
		RAISE EXCEPTION 'Pick weekly, monthly or yearly, repeating every 1 to 12.';
	END IF;
	IF p_first_due < ((now() AT TIME ZONE 'Africa/Accra')::date) THEN
		RAISE EXCEPTION 'The first due date can''t be in the past.';
	END IF;
	IF p_end IS NOT NULL AND p_end < p_first_due THEN
		RAISE EXCEPTION 'The end date can''t be before the first due date.';
	END IF;
	SELECT currency INTO cur FROM "public"."accounts"
		WHERE id = p_account AND user_id = uid AND archived_at IS NULL;
	IF cur IS NULL THEN
		RAISE EXCEPTION 'That account was not found.' USING ERRCODE = 'no_data_found';
	END IF;
	IF p_category IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "public"."categories"
		WHERE id = p_category AND user_id = uid AND kind = p_kind AND archived_at IS NULL
	) THEN
		RAISE EXCEPTION 'That category was not found, or it is the wrong kind for this bill.'
			USING ERRCODE = 'no_data_found';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	INSERT INTO "public"."recurring_rules"
		("id", "user_id", "kind", "name", "amount", "currency", "account_id", "category_id",
		 "frequency", "repeat_every", "anchor_day", "next_due", "end_date", "auto_post")
	VALUES
		(p_id, uid, p_kind, nm, p_amount, cur, p_account, p_category,
		 p_frequency, p_every, extract(day FROM p_first_due)::integer, p_first_due, p_end, COALESCE(p_auto, false))
	ON CONFLICT ("id") DO NOTHING;

	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'recurring_rules' AND row_id = p_id
			AND action = 'insert' AND actor = 'assistant'
		ORDER BY created_at LIMIT 1;

	RETURN jsonb_build_object('id', p_id, 'undo_token', token);
END;
$$;
--> statement-breakpoint

-- Patch keys: name, amount, account_id, category_id (null clears), end_date (null
-- clears), auto_post, paused. The schedule itself is changed in the app.
CREATE FUNCTION "public"."assistant_update_bill"("p_id" uuid, "p_patch" jsonb) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	r record;
	nm text;
	new_end date;
	token uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch = '{}'::jsonb THEN
		RAISE EXCEPTION 'Nothing to change.';
	END IF;
	IF EXISTS (
		SELECT 1 FROM jsonb_object_keys(p_patch) k
		WHERE k NOT IN ('name', 'amount', 'account_id', 'category_id', 'end_date', 'auto_post', 'paused')
	) THEN
		RAISE EXCEPTION 'That field can''t be changed this way.';
	END IF;
	SELECT * INTO r FROM "public"."recurring_rules" WHERE id = p_id AND user_id = uid FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'That bill was not found.' USING ERRCODE = 'no_data_found';
	END IF;

	IF p_patch ? 'name' THEN
		nm := btrim(p_patch ->> 'name');
		IF nm IS NULL OR char_length(nm) NOT BETWEEN 1 AND 60 THEN
			RAISE EXCEPTION 'Use a name of 1 to 60 characters.';
		END IF;
	END IF;
	IF p_patch ? 'amount' AND ((p_patch ->> 'amount')::bigint < 1 OR (p_patch ->> 'amount')::bigint > 99999999999999) THEN
		RAISE EXCEPTION 'That amount is out of range.';
	END IF;
	IF p_patch ? 'account_id' AND NOT EXISTS (
		SELECT 1 FROM "public"."accounts"
		WHERE id = (p_patch ->> 'account_id')::uuid AND user_id = uid AND archived_at IS NULL
			AND currency = r.currency
	) THEN
		RAISE EXCEPTION 'That account was not found, or it uses another currency than this bill.'
			USING ERRCODE = 'no_data_found';
	END IF;
	IF p_patch ? 'category_id' AND (p_patch ->> 'category_id') IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "public"."categories"
		WHERE id = (p_patch ->> 'category_id')::uuid AND user_id = uid AND kind = r.kind AND archived_at IS NULL
	) THEN
		RAISE EXCEPTION 'That category was not found, or it is the wrong kind for this bill.'
			USING ERRCODE = 'no_data_found';
	END IF;
	IF p_patch ? 'end_date' THEN
		new_end := (p_patch ->> 'end_date')::date;
		IF new_end IS NOT NULL AND new_end < r.next_due THEN
			RAISE EXCEPTION 'The end date can''t be before the next due date.';
		END IF;
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	UPDATE "public"."recurring_rules" t SET
		"name" = CASE WHEN p_patch ? 'name' THEN nm ELSE t."name" END,
		"amount" = CASE WHEN p_patch ? 'amount' THEN (p_patch ->> 'amount')::bigint ELSE t."amount" END,
		"account_id" = CASE WHEN p_patch ? 'account_id' THEN (p_patch ->> 'account_id')::uuid ELSE t."account_id" END,
		"category_id" = CASE WHEN p_patch ? 'category_id' THEN (p_patch ->> 'category_id')::uuid ELSE t."category_id" END,
		"end_date" = CASE WHEN p_patch ? 'end_date' THEN new_end ELSE t."end_date" END,
		"auto_post" = CASE WHEN p_patch ? 'auto_post' THEN (p_patch ->> 'auto_post')::boolean ELSE t."auto_post" END,
		"paused_at" = CASE WHEN p_patch ? 'paused'
			THEN CASE WHEN (p_patch ->> 'paused')::boolean THEN COALESCE(t."paused_at", now()) ELSE NULL END
			ELSE t."paused_at" END
	WHERE t."id" = p_id AND t."user_id" = uid;

	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'recurring_rules' AND row_id = p_id
			AND action = 'update' AND actor = 'assistant' AND created_at = now()
		LIMIT 1;

	RETURN jsonb_build_object('id', p_id, 'undo_token', token);
END;
$$;
--> statement-breakpoint

-- Records the due occurrence as paid (usual amount, or the amount actually paid)
-- and moves the bill on. Undoing puts the due date back and hides the entry.
CREATE FUNCTION "public"."assistant_pay_bill"("p_id" uuid, "p_amount" bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	r "public"."recurring_rules"%ROWTYPE;
	tid uuid;
	paid_for date;
	token uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF p_amount IS NOT NULL AND (p_amount < 1 OR p_amount > 99999999999999) THEN
		RAISE EXCEPTION 'That amount is out of range.';
	END IF;
	SELECT * INTO r FROM "public"."recurring_rules" WHERE id = p_id AND user_id = uid FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'That bill was not found.' USING ERRCODE = 'no_data_found';
	END IF;
	IF r.paused_at IS NOT NULL THEN
		RAISE EXCEPTION 'That bill is paused. Resume it first.';
	END IF;
	IF r.end_date IS NOT NULL AND r.next_due > r.end_date THEN
		RAISE EXCEPTION 'That bill has ended.';
	END IF;
	IF EXISTS (SELECT 1 FROM "public"."accounts" WHERE id = r.account_id AND archived_at IS NOT NULL) THEN
		RAISE EXCEPTION 'The account for that bill is archived. Move the bill to another account first.';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);
	paid_for := r.next_due;

	INSERT INTO "public"."transactions" (
		"user_id", "account_id", "type", "amount", "currency", "occurred_at",
		"category_id", "payee", "source", "idempotency_key"
	) VALUES (
		uid, r.account_id, r.kind, COALESCE(p_amount, r.amount), r.currency, now(),
		r.category_id, r.name, 'recurring', 'rec:' || r.id::text || ':' || paid_for::text
	)
	ON CONFLICT ("user_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL
	DO NOTHING
	RETURNING id INTO tid;
	IF tid IS NULL THEN
		RAISE EXCEPTION 'That payment was already recorded.';
	END IF;

	UPDATE "public"."recurring_rules"
		SET next_due = "public"."recurring_advance"(paid_for, r.frequency, r.repeat_every, r.anchor_day)
		WHERE id = r.id;

	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'recurring_rules' AND row_id = p_id
			AND action = 'update' AND actor = 'assistant' AND created_at = now()
		LIMIT 1;

	RETURN jsonb_build_object('id', p_id, 'undo_token', token, 'transaction_id', tid, 'paid_for', paid_for);
END;
$$;
--> statement-breakpoint

-- Skips the due occurrence without recording anything.
CREATE FUNCTION "public"."assistant_skip_bill"("p_id" uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	r "public"."recurring_rules"%ROWTYPE;
	token uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	SELECT * INTO r FROM "public"."recurring_rules" WHERE id = p_id AND user_id = uid FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'That bill was not found.' USING ERRCODE = 'no_data_found';
	END IF;
	IF r.paused_at IS NOT NULL THEN
		RAISE EXCEPTION 'That bill is paused. Resume it first.';
	END IF;
	IF r.end_date IS NOT NULL AND r.next_due > r.end_date THEN
		RAISE EXCEPTION 'That bill has ended.';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	UPDATE "public"."recurring_rules"
		SET next_due = "public"."recurring_advance"(r.next_due, r.frequency, r.repeat_every, r.anchor_day)
		WHERE id = r.id;

	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'recurring_rules' AND row_id = p_id
			AND action = 'update' AND actor = 'assistant' AND created_at = now()
		LIMIT 1;

	RETURN jsonb_build_object('id', p_id, 'undo_token', token, 'skipped', r.next_due);
END;
$$;
--> statement-breakpoint

-- Reverses one assistant change. A row touched since is left alone, and anything
-- that has been used since is archived or removed by hand, not undone here.
CREATE OR REPLACE FUNCTION "public"."assistant_undo"("p_token" uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	a record;
	t record;
	bud record;
	cur record;
	b jsonb;
	paid_key text;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	SELECT * INTO a FROM "public"."audit_log"
		WHERE id = p_token AND user_id = uid AND actor = 'assistant'
			AND table_name IN ('transactions', 'budgets', 'accounts', 'categories', 'recurring_rules');
	IF NOT FOUND THEN
		RAISE EXCEPTION 'There is nothing to undo.' USING ERRCODE = 'no_data_found';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	IF a.table_name = 'budgets' THEN
		SELECT * INTO bud FROM "public"."budgets" WHERE id = a.row_id AND user_id = uid;
		IF a.action = 'delete' THEN
			IF FOUND OR EXISTS (
				SELECT 1 FROM "public"."budgets"
				WHERE user_id = uid AND category_id IS NOT DISTINCT FROM (a.before ->> 'category_id')::uuid
			) THEN
				RAISE EXCEPTION 'A budget has been set again since, so this can''t be undone automatically.';
			END IF;
			b := a.before;
			INSERT INTO "public"."budgets" ("id", "user_id", "category_id", "amount", "currency")
			VALUES (a.row_id, uid, (b ->> 'category_id')::uuid, (b ->> 'amount')::bigint, b ->> 'currency');
		ELSE
			IF NOT FOUND THEN
				RAISE EXCEPTION 'There is nothing to undo.' USING ERRCODE = 'no_data_found';
			END IF;
			IF bud.updated_at IS DISTINCT FROM (a.after ->> 'updated_at')::timestamptz THEN
				RAISE EXCEPTION 'That budget has changed since, so it can''t be undone automatically.';
			END IF;
			IF a.action = 'insert' THEN
				DELETE FROM "public"."budgets" WHERE id = a.row_id AND user_id = uid;
			ELSIF a.action = 'update' THEN
				b := a.before;
				UPDATE "public"."budgets"
					SET amount = (b ->> 'amount')::bigint, currency = b ->> 'currency'
					WHERE id = a.row_id AND user_id = uid;
			END IF;
		END IF;
		RETURN jsonb_build_object('id', a.row_id, 'action', a.action);
	END IF;

	IF a.table_name = 'accounts' THEN
		SELECT * INTO cur FROM "public"."accounts" WHERE id = a.row_id AND user_id = uid;
		IF NOT FOUND OR a.action NOT IN ('insert', 'update') THEN
			RAISE EXCEPTION 'There is nothing to undo.' USING ERRCODE = 'no_data_found';
		END IF;
		IF cur.updated_at IS DISTINCT FROM (a.after ->> 'updated_at')::timestamptz THEN
			RAISE EXCEPTION 'That account has changed since, so it can''t be undone automatically.';
		END IF;
		IF a.action = 'insert' THEN
			IF EXISTS (SELECT 1 FROM "public"."transactions" WHERE account_id = a.row_id)
				OR EXISTS (SELECT 1 FROM "public"."recurring_rules" WHERE account_id = a.row_id) THEN
				RAISE EXCEPTION 'That account has been used since, so it can''t be undone automatically. Archive it instead.';
			END IF;
			DELETE FROM "public"."accounts" WHERE id = a.row_id AND user_id = uid;
		ELSE
			b := a.before;
			UPDATE "public"."accounts"
				SET name = b ->> 'name', archived_at = (b ->> 'archived_at')::timestamptz
				WHERE id = a.row_id AND user_id = uid;
		END IF;
		RETURN jsonb_build_object('id', a.row_id, 'action', a.action);
	END IF;

	IF a.table_name = 'categories' THEN
		SELECT * INTO cur FROM "public"."categories" WHERE id = a.row_id AND user_id = uid;
		IF NOT FOUND OR a.action NOT IN ('insert', 'update') THEN
			RAISE EXCEPTION 'There is nothing to undo.' USING ERRCODE = 'no_data_found';
		END IF;
		IF cur.updated_at IS DISTINCT FROM (a.after ->> 'updated_at')::timestamptz THEN
			RAISE EXCEPTION 'That category has changed since, so it can''t be undone automatically.';
		END IF;
		IF a.action = 'insert' THEN
			IF EXISTS (SELECT 1 FROM "public"."transactions" WHERE category_id = a.row_id)
				OR EXISTS (SELECT 1 FROM "public"."recurring_rules" WHERE category_id = a.row_id)
				OR EXISTS (SELECT 1 FROM "public"."budgets" WHERE category_id = a.row_id)
				OR EXISTS (SELECT 1 FROM "public"."categories" WHERE parent_id = a.row_id) THEN
				RAISE EXCEPTION 'That category has been used since, so it can''t be undone automatically. Archive it instead.';
			END IF;
			DELETE FROM "public"."categories" WHERE id = a.row_id AND user_id = uid;
		ELSE
			b := a.before;
			UPDATE "public"."categories"
				SET name = b ->> 'name', archived_at = (b ->> 'archived_at')::timestamptz
				WHERE id = a.row_id AND user_id = uid;
		END IF;
		RETURN jsonb_build_object('id', a.row_id, 'action', a.action);
	END IF;

	IF a.table_name = 'recurring_rules' THEN
		SELECT * INTO cur FROM "public"."recurring_rules" WHERE id = a.row_id AND user_id = uid;
		IF NOT FOUND OR a.action NOT IN ('insert', 'update') THEN
			RAISE EXCEPTION 'There is nothing to undo.' USING ERRCODE = 'no_data_found';
		END IF;
		IF cur.updated_at IS DISTINCT FROM (a.after ->> 'updated_at')::timestamptz THEN
			RAISE EXCEPTION 'That bill has changed since, so it can''t be undone automatically.';
		END IF;
		IF a.action = 'insert' THEN
			IF EXISTS (
				SELECT 1 FROM "public"."transactions"
				WHERE user_id = uid AND idempotency_key LIKE 'rec:' || a.row_id::text || ':%'
			) THEN
				RAISE EXCEPTION 'That bill has recorded entries since, so it can''t be undone automatically. Pause it instead.';
			END IF;
			DELETE FROM "public"."recurring_rules" WHERE id = a.row_id AND user_id = uid;
		ELSE
			b := a.before;
			-- A payment is undone together with the entry it made, which must be untouched.
			IF (b ->> 'next_due')::date IS DISTINCT FROM cur.next_due THEN
				paid_key := 'rec:' || a.row_id::text || ':' || (b ->> 'next_due');
				SELECT * INTO t FROM "public"."transactions"
					WHERE user_id = uid AND idempotency_key = paid_key AND deleted_at IS NULL;
				IF FOUND THEN
					IF t.updated_at IS DISTINCT FROM t.created_at THEN
						RAISE EXCEPTION 'The entry that payment made has been edited, so it can''t be undone automatically.';
					END IF;
					-- The key is freed so the same payment can be recorded again later.
					UPDATE "public"."transactions"
						SET deleted_at = now(), idempotency_key = NULL
						WHERE id = t.id AND user_id = uid;
				END IF;
			END IF;
			UPDATE "public"."recurring_rules" SET
				name = b ->> 'name',
				amount = (b ->> 'amount')::bigint,
				account_id = (b ->> 'account_id')::uuid,
				category_id = (b ->> 'category_id')::uuid,
				next_due = (b ->> 'next_due')::date,
				end_date = (b ->> 'end_date')::date,
				auto_post = (b ->> 'auto_post')::boolean,
				paused_at = (b ->> 'paused_at')::timestamptz
				WHERE id = a.row_id AND user_id = uid;
		END IF;
		RETURN jsonb_build_object('id', a.row_id, 'action', a.action);
	END IF;

	SELECT * INTO t FROM "public"."transactions" WHERE id = a.row_id AND user_id = uid;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'There is nothing to undo.' USING ERRCODE = 'no_data_found';
	END IF;
	IF t.updated_at IS DISTINCT FROM (a.after ->> 'updated_at')::timestamptz THEN
		RAISE EXCEPTION 'That entry has changed since, so it can''t be undone automatically.';
	END IF;

	IF a.action = 'insert' THEN
		UPDATE "public"."transactions" SET "deleted_at" = now() WHERE id = a.row_id AND user_id = uid;
	ELSIF a.action = 'update' THEN
		b := a.before;
		UPDATE "public"."transactions" SET
			"account_id" = (b ->> 'account_id')::uuid,
			"currency" = b ->> 'currency',
			"type" = b ->> 'type',
			"amount" = (b ->> 'amount')::bigint,
			"occurred_at" = (b ->> 'occurred_at')::timestamptz,
			"category_id" = (b ->> 'category_id')::uuid,
			"payee" = b ->> 'payee',
			"note" = b ->> 'note',
			"deleted_at" = (b ->> 'deleted_at')::timestamptz
		WHERE id = a.row_id AND user_id = uid;
	ELSE
		RAISE EXCEPTION 'There is nothing to undo.' USING ERRCODE = 'no_data_found';
	END IF;

	RETURN jsonb_build_object('id', a.row_id, 'action', a.action);
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION "public"."assistant_create_bill"(uuid, text, text, bigint, uuid, uuid, text, integer, date, date, boolean) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."assistant_update_bill"(uuid, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."assistant_pay_bill"(uuid, bigint) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."assistant_skip_bill"(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_create_bill"(uuid, text, text, bigint, uuid, uuid, text, integer, date, date, boolean) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_update_bill"(uuid, jsonb) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_pay_bill"(uuid, bigint) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_skip_bill"(uuid) TO authenticated;
