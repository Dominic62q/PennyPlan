-- Budgets changed by the assistant ---------------------------------------------
-- Same pattern as transactions: runs as the person, tags the audit rows as
-- 'assistant', hands back an undo token. assistant_undo now handles budgets too.

CREATE FUNCTION "public"."assistant_set_budget"(
	"p_category" uuid,
	"p_amount" bigint,
	"p_currency" text DEFAULT 'GHS'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	bid uuid;
	old_amount bigint;
	token uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF p_amount IS NULL OR p_amount < 1 OR p_amount > 99999999999999 THEN
		RAISE EXCEPTION 'That budget amount is out of range.';
	END IF;
	IF p_category IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "public"."categories"
		WHERE id = p_category AND user_id = uid AND kind = 'expense' AND archived_at IS NULL
	) THEN
		RAISE EXCEPTION 'Budgets can only be set on open spending categories.' USING ERRCODE = 'no_data_found';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	SELECT id, amount INTO bid, old_amount FROM "public"."budgets"
		WHERE user_id = uid AND category_id IS NOT DISTINCT FROM p_category;

	IF bid IS NULL THEN
		INSERT INTO "public"."budgets" ("user_id", "category_id", "amount", "currency")
		VALUES (uid, p_category, p_amount, p_currency)
		RETURNING id INTO bid;
		SELECT id INTO token FROM "public"."audit_log"
			WHERE user_id = uid AND table_name = 'budgets' AND row_id = bid
				AND action = 'insert' AND actor = 'assistant'
			ORDER BY created_at DESC LIMIT 1;
	ELSE
		UPDATE "public"."budgets" SET amount = p_amount, currency = p_currency WHERE id = bid;
		SELECT id INTO token FROM "public"."audit_log"
			WHERE user_id = uid AND table_name = 'budgets' AND row_id = bid
				AND action = 'update' AND actor = 'assistant' AND created_at = now()
			LIMIT 1;
	END IF;

	RETURN jsonb_build_object('id', bid, 'undo_token', token, 'previous_amount', old_amount);
END;
$$;
--> statement-breakpoint

CREATE FUNCTION "public"."assistant_remove_budget"("p_category" uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	bid uuid;
	old_amount bigint;
	token uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	DELETE FROM "public"."budgets"
		WHERE user_id = uid AND category_id IS NOT DISTINCT FROM p_category
		RETURNING id, amount INTO bid, old_amount;
	IF bid IS NULL THEN
		RAISE EXCEPTION 'There is no budget set for that.' USING ERRCODE = 'no_data_found';
	END IF;

	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'budgets' AND row_id = bid
			AND action = 'delete' AND actor = 'assistant'
		ORDER BY created_at DESC LIMIT 1;

	RETURN jsonb_build_object('id', bid, 'undo_token', token, 'previous_amount', old_amount);
END;
$$;
--> statement-breakpoint

-- Reverses one assistant change. A row touched since is left alone.
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
	b jsonb;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	SELECT * INTO a FROM "public"."audit_log"
		WHERE id = p_token AND user_id = uid AND actor = 'assistant'
			AND table_name IN ('transactions', 'budgets');
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

REVOKE ALL ON FUNCTION "public"."assistant_set_budget"(uuid, bigint, text) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."assistant_remove_budget"(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_set_budget"(uuid, bigint, text) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_remove_budget"(uuid) TO authenticated;
