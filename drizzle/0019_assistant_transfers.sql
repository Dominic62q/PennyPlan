-- Transfers made by the assistant ------------------------------------------------
-- Moves money between two of the person's own open accounts through the same
-- create_transfer the app uses (both sides, plus an optional fee, in one call),
-- tagged as the assistant's. The undo token is the audit row of the money-out
-- side; undoing it hides the whole transfer.

CREATE FUNCTION "public"."assistant_create_transfer"(
	"p_group_id" uuid,
	"p_from" uuid,
	"p_to" uuid,
	"p_amount_out" bigint,
	"p_amount_in" bigint DEFAULT NULL,
	"p_occurred_at" timestamptz DEFAULT now(),
	"p_note" text DEFAULT NULL,
	"p_fee" bigint DEFAULT NULL,
	"p_fee_category" uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	out_id uuid;
	token uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF p_from = p_to THEN
		RAISE EXCEPTION 'Choose two different accounts.';
	END IF;
	IF p_amount_out IS NULL OR p_amount_out < 1 OR p_amount_out > 99999999999999
		OR (p_amount_in IS NOT NULL AND (p_amount_in < 1 OR p_amount_in > 99999999999999))
		OR (p_fee IS NOT NULL AND (p_fee < 1 OR p_fee > 99999999999999)) THEN
		RAISE EXCEPTION 'That amount is out of range.';
	END IF;
	IF (SELECT count(*) FROM "public"."accounts"
		WHERE user_id = uid AND id IN (p_from, p_to) AND archived_at IS NULL) <> 2 THEN
		RAISE EXCEPTION 'One of those accounts was not found, or it is archived.'
			USING ERRCODE = 'no_data_found';
	END IF;
	IF p_fee_category IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "public"."categories"
		WHERE id = p_fee_category AND user_id = uid AND kind = 'expense' AND archived_at IS NULL
	) THEN
		RAISE EXCEPTION 'That fee category was not found, or it is not a spending category.'
			USING ERRCODE = 'no_data_found';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	PERFORM "public"."create_transfer"(
		p_group_id, p_from, p_to, p_amount_out, p_amount_in, p_occurred_at,
		p_note, p_fee, p_fee_category, 'assistant'
	);

	SELECT id INTO out_id FROM "public"."transactions"
		WHERE user_id = uid AND idempotency_key = p_group_id::text || ':out';
	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'transactions' AND row_id = out_id
			AND action = 'insert' AND actor = 'assistant'
		ORDER BY created_at LIMIT 1;

	RETURN jsonb_build_object('id', p_group_id, 'undo_token', token);
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
--> statement-breakpoint

REVOKE ALL ON FUNCTION "public"."assistant_create_transfer"(uuid, uuid, uuid, bigint, bigint, timestamptz, text, bigint, uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_create_transfer"(uuid, uuid, uuid, bigint, bigint, timestamptz, text, bigint, uuid) TO authenticated;
