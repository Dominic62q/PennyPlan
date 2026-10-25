-- Opening balance can now be changed by the assistant --------------------------------
-- Patch keys: name (text), archived (boolean), opening_balance (whole minor units).
-- The balance shown is opening_balance plus the entries, so changing it moves the
-- balance by the difference. assistant_undo puts the old value back.
CREATE OR REPLACE FUNCTION "public"."assistant_update_account"("p_id" uuid, "p_patch" jsonb) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	nm text;
	ob numeric;
	token uuid;
	bills int;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch = '{}'::jsonb THEN
		RAISE EXCEPTION 'Nothing to change.';
	END IF;
	IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('name', 'archived', 'opening_balance')) THEN
		RAISE EXCEPTION 'That field can''t be changed this way.';
	END IF;
	IF p_patch ? 'name' THEN
		nm := btrim(p_patch ->> 'name');
		IF nm IS NULL OR char_length(nm) NOT BETWEEN 1 AND 60 THEN
			RAISE EXCEPTION 'Use a name of 1 to 60 characters.';
		END IF;
		IF EXISTS (SELECT 1 FROM "public"."accounts" WHERE user_id = uid AND lower(name) = lower(nm) AND id <> p_id) THEN
			RAISE EXCEPTION 'You already have an account with that name.';
		END IF;
	END IF;
	IF p_patch ? 'opening_balance' THEN
		IF jsonb_typeof(p_patch -> 'opening_balance') IS DISTINCT FROM 'number' THEN
			RAISE EXCEPTION 'The opening balance must be a number.';
		END IF;
		ob := (p_patch ->> 'opening_balance')::numeric;
		IF ob <> trunc(ob) OR abs(ob) > 99999999999999 THEN
			RAISE EXCEPTION 'That opening balance is out of range.';
		END IF;
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	UPDATE "public"."accounts" a SET
		"name" = CASE WHEN p_patch ? 'name' THEN nm ELSE a."name" END,
		"opening_balance" = CASE WHEN p_patch ? 'opening_balance' THEN ob::bigint ELSE a."opening_balance" END,
		"archived_at" = CASE WHEN p_patch ? 'archived'
			THEN CASE WHEN (p_patch ->> 'archived')::boolean THEN COALESCE(a."archived_at", now()) ELSE NULL END
			ELSE a."archived_at" END
	WHERE a."id" = p_id AND a."user_id" = uid;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'That account was not found.' USING ERRCODE = 'no_data_found';
	END IF;

	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'accounts' AND row_id = p_id
			AND action = 'update' AND actor = 'assistant' AND created_at = now()
		LIMIT 1;

	-- Bills still set to come out of this account, so the person can be told.
	SELECT count(*)::int INTO bills FROM "public"."recurring_rules"
		WHERE user_id = uid AND account_id = p_id AND paused_at IS NULL
			AND (end_date IS NULL OR end_date >= current_date);

	RETURN jsonb_build_object('id', p_id, 'undo_token', token, 'active_bills', bills);
END;
$$;
--> statement-breakpoint

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
				SET name = b ->> 'name', archived_at = (b ->> 'archived_at')::timestamptz,
						opening_balance = (b ->> 'opening_balance')::bigint
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

	IF a.action = 'insert' AND t.transfer_group_id IS NOT NULL THEN
		-- A transfer is undone as a whole: both sides and the fee, if none was touched since.
		IF EXISTS (
			SELECT 1 FROM "public"."transactions"
			WHERE user_id = uid AND deleted_at IS NULL
				AND (transfer_group_id = t.transfer_group_id OR idempotency_key = t.transfer_group_id::text || ':fee')
				AND updated_at IS DISTINCT FROM created_at
		) THEN
			RAISE EXCEPTION 'That transfer has changed since, so it can''t be undone automatically.';
		END IF;
		UPDATE "public"."transactions" SET "deleted_at" = now()
			WHERE user_id = uid AND deleted_at IS NULL
				AND (transfer_group_id = t.transfer_group_id OR idempotency_key = t.transfer_group_id::text || ':fee');
	ELSIF a.action = 'insert' THEN
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
