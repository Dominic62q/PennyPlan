-- Changes made by the assistant ------------------------------------------------
-- Each one runs as the signed-in person (row level security still decides) and
-- tags the audit rows it causes with the actor 'assistant'. Every change hands
-- back an undo token: the id of its audit row, which assistant_undo reverses.
-- Messages raised here (error code P0001) are written for people and are shown
-- as they are.

CREATE FUNCTION "public"."assistant_add_transaction"(
	"p_id" uuid,
	"p_account" uuid,
	"p_type" text,
	"p_amount" bigint,
	"p_occurred_at" timestamptz,
	"p_category" uuid DEFAULT NULL,
	"p_payee" text DEFAULT NULL,
	"p_note" text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	cur text;
	token uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF p_type NOT IN ('expense', 'income') THEN
		RAISE EXCEPTION 'Only expenses and income can be added this way.';
	END IF;
	SELECT currency INTO cur FROM "public"."accounts"
		WHERE id = p_account AND user_id = uid AND archived_at IS NULL;
	IF cur IS NULL THEN
		RAISE EXCEPTION 'That account was not found.' USING ERRCODE = 'no_data_found';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	-- The same id on a retry lands on the row the first attempt made.
	INSERT INTO "public"."transactions"
		("id", "user_id", "account_id", "type", "amount", "currency", "occurred_at",
		 "category_id", "payee", "note", "source", "idempotency_key")
	VALUES
		(p_id, uid, p_account, p_type, p_amount, cur, p_occurred_at,
		 p_category, NULLIF(btrim(p_payee), ''), NULLIF(btrim(p_note), ''),
		 'assistant', 'assistant:' || p_id::text)
	ON CONFLICT ("user_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL
	DO NOTHING;

	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'transactions' AND row_id = p_id
			AND action = 'insert' AND actor = 'assistant'
		ORDER BY created_at LIMIT 1;

	RETURN jsonb_build_object('id', p_id, 'undo_token', token);
END;
$$;
--> statement-breakpoint

-- Changes only the fields named in the patch (a null value clears a field).
CREATE FUNCTION "public"."assistant_update_transaction"(
	"p_id" uuid,
	"p_patch" jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	new_currency text;
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
		WHERE k NOT IN ('account_id', 'type', 'amount', 'occurred_at', 'category_id', 'payee', 'note')
	) THEN
		RAISE EXCEPTION 'That field can''t be changed this way.';
	END IF;

	IF p_patch ? 'account_id' THEN
		SELECT currency INTO new_currency FROM "public"."accounts"
			WHERE id = (p_patch ->> 'account_id')::uuid AND user_id = uid AND archived_at IS NULL;
		IF new_currency IS NULL THEN
			RAISE EXCEPTION 'That account was not found.' USING ERRCODE = 'no_data_found';
		END IF;
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	UPDATE "public"."transactions" t SET
		"account_id" = CASE WHEN p_patch ? 'account_id' THEN (p_patch ->> 'account_id')::uuid ELSE t."account_id" END,
		"currency" = CASE WHEN p_patch ? 'account_id' THEN new_currency ELSE t."currency" END,
		"type" = CASE WHEN p_patch ? 'type' THEN p_patch ->> 'type' ELSE t."type" END,
		"amount" = CASE WHEN p_patch ? 'amount' THEN (p_patch ->> 'amount')::bigint ELSE t."amount" END,
		"occurred_at" = CASE WHEN p_patch ? 'occurred_at' THEN (p_patch ->> 'occurred_at')::timestamptz ELSE t."occurred_at" END,
		"category_id" = CASE WHEN p_patch ? 'category_id' THEN (p_patch ->> 'category_id')::uuid ELSE t."category_id" END,
		"payee" = CASE WHEN p_patch ? 'payee' THEN NULLIF(btrim(p_patch ->> 'payee'), '') ELSE t."payee" END,
		"note" = CASE WHEN p_patch ? 'note' THEN NULLIF(btrim(p_patch ->> 'note'), '') ELSE t."note" END
	WHERE t."id" = p_id
		AND t."user_id" = uid
		AND t."transfer_group_id" IS NULL
		AND t."deleted_at" IS NULL;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'That transaction was not found, or it is part of a transfer.'
			USING ERRCODE = 'no_data_found';
	END IF;

	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'transactions' AND row_id = p_id
			AND action = 'update' AND actor = 'assistant' AND created_at = now()
		LIMIT 1;

	RETURN jsonb_build_object('id', p_id, 'undo_token', token);
END;
$$;
--> statement-breakpoint

-- Reverses one assistant change: an add is hidden again, an edit goes back to
-- how the row was. If the row has been touched since, it is left alone.
CREATE FUNCTION "public"."assistant_undo"("p_token" uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	a record;
	t record;
	b jsonb;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	SELECT * INTO a FROM "public"."audit_log"
		WHERE id = p_token AND user_id = uid AND actor = 'assistant' AND table_name = 'transactions';
	IF NOT FOUND THEN
		RAISE EXCEPTION 'There is nothing to undo.' USING ERRCODE = 'no_data_found';
	END IF;
	SELECT * INTO t FROM "public"."transactions" WHERE id = a.row_id AND user_id = uid;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'There is nothing to undo.' USING ERRCODE = 'no_data_found';
	END IF;
	IF t.updated_at IS DISTINCT FROM (a.after ->> 'updated_at')::timestamptz THEN
		RAISE EXCEPTION 'That entry has changed since, so it can''t be undone automatically.';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

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

REVOKE ALL ON FUNCTION "public"."assistant_add_transaction"(uuid, uuid, text, bigint, timestamptz, uuid, text, text) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."assistant_update_transaction"(uuid, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."assistant_undo"(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_add_transaction"(uuid, uuid, text, bigint, timestamptz, uuid, text, text) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_update_transaction"(uuid, jsonb) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_undo"(uuid) TO authenticated;
