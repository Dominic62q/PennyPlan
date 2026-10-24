-- Accounts and categories changed by the assistant --------------------------------
-- Same pattern as budgets: runs as the person, tags audit rows 'assistant', hands
-- back an undo token. Messages raised here are written for people.

CREATE FUNCTION "public"."assistant_create_account"(
	"p_id" uuid,
	"p_name" text,
	"p_type" text,
	"p_currency" text DEFAULT 'GHS',
	"p_opening" bigint DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	nm text := btrim(p_name);
	token uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF nm IS NULL OR char_length(nm) NOT BETWEEN 1 AND 60 THEN
		RAISE EXCEPTION 'Use a name of 1 to 60 characters.';
	END IF;
	IF EXISTS (SELECT 1 FROM "public"."accounts" WHERE user_id = uid AND lower(name) = lower(nm) AND id <> p_id) THEN
		RAISE EXCEPTION 'You already have an account with that name.';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	INSERT INTO "public"."accounts" ("id", "user_id", "name", "type", "currency", "opening_balance")
	VALUES (p_id, uid, nm, p_type, p_currency, COALESCE(p_opening, 0))
	ON CONFLICT ("id") DO NOTHING;

	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'accounts' AND row_id = p_id
			AND action = 'insert' AND actor = 'assistant'
		ORDER BY created_at LIMIT 1;

	RETURN jsonb_build_object('id', p_id, 'undo_token', token);
END;
$$;
--> statement-breakpoint

-- Patch keys: name (text), archived (boolean).
CREATE FUNCTION "public"."assistant_update_account"("p_id" uuid, "p_patch" jsonb) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	nm text;
	token uuid;
	bills int;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch = '{}'::jsonb THEN
		RAISE EXCEPTION 'Nothing to change.';
	END IF;
	IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('name', 'archived')) THEN
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

	PERFORM set_config('app.actor', 'assistant', true);

	UPDATE "public"."accounts" a SET
		"name" = CASE WHEN p_patch ? 'name' THEN nm ELSE a."name" END,
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

CREATE FUNCTION "public"."assistant_create_category"(
	"p_id" uuid,
	"p_name" text,
	"p_kind" text,
	"p_parent" uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	nm text := btrim(p_name);
	token uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF nm IS NULL OR char_length(nm) NOT BETWEEN 1 AND 60 THEN
		RAISE EXCEPTION 'Use a name of 1 to 60 characters.';
	END IF;
	IF p_kind NOT IN ('income', 'expense') THEN
		RAISE EXCEPTION 'A category is either income or expense.';
	END IF;
	IF p_parent IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "public"."categories"
		WHERE id = p_parent AND user_id = uid AND kind = p_kind AND parent_id IS NULL AND archived_at IS NULL
	) THEN
		RAISE EXCEPTION 'The parent must be an open top-level % category.', p_kind
			USING ERRCODE = 'no_data_found';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "public"."categories"
		WHERE user_id = uid AND kind = p_kind AND lower(name) = lower(nm)
			AND parent_id IS NOT DISTINCT FROM p_parent AND id <> p_id
	) THEN
		RAISE EXCEPTION 'There is already a category with that name there.';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	INSERT INTO "public"."categories" ("id", "user_id", "name", "kind", "parent_id")
	VALUES (p_id, uid, nm, p_kind, p_parent)
	ON CONFLICT ("id") DO NOTHING;

	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'categories' AND row_id = p_id
			AND action = 'insert' AND actor = 'assistant'
		ORDER BY created_at LIMIT 1;

	RETURN jsonb_build_object('id', p_id, 'undo_token', token);
END;
$$;
--> statement-breakpoint

-- Patch keys: name (text), archived (boolean).
CREATE FUNCTION "public"."assistant_update_category"("p_id" uuid, "p_patch" jsonb) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	cat record;
	nm text;
	token uuid;
	subs int;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch = '{}'::jsonb THEN
		RAISE EXCEPTION 'Nothing to change.';
	END IF;
	IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('name', 'archived')) THEN
		RAISE EXCEPTION 'That field can''t be changed this way.';
	END IF;
	SELECT * INTO cat FROM "public"."categories" WHERE id = p_id AND user_id = uid;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'That category was not found.' USING ERRCODE = 'no_data_found';
	END IF;
	IF p_patch ? 'name' THEN
		nm := btrim(p_patch ->> 'name');
		IF nm IS NULL OR char_length(nm) NOT BETWEEN 1 AND 60 THEN
			RAISE EXCEPTION 'Use a name of 1 to 60 characters.';
		END IF;
		IF EXISTS (
			SELECT 1 FROM "public"."categories"
			WHERE user_id = uid AND kind = cat.kind AND lower(name) = lower(nm)
				AND parent_id IS NOT DISTINCT FROM cat.parent_id AND id <> p_id
		) THEN
			RAISE EXCEPTION 'There is already a category with that name there.';
		END IF;
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	UPDATE "public"."categories" c SET
		"name" = CASE WHEN p_patch ? 'name' THEN nm ELSE c."name" END,
		"archived_at" = CASE WHEN p_patch ? 'archived'
			THEN CASE WHEN (p_patch ->> 'archived')::boolean THEN COALESCE(c."archived_at", now()) ELSE NULL END
			ELSE c."archived_at" END
	WHERE c."id" = p_id AND c."user_id" = uid;

	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'categories' AND row_id = p_id
			AND action = 'update' AND actor = 'assistant' AND created_at = now()
		LIMIT 1;

	SELECT count(*)::int INTO subs FROM "public"."categories"
		WHERE user_id = uid AND parent_id = p_id AND archived_at IS NULL;

	RETURN jsonb_build_object('id', p_id, 'undo_token', token, 'open_subcategories', subs);
END;
$$;
--> statement-breakpoint

-- Reverses one assistant change. A row touched since is left alone, and an
-- account or category that has been used since is archived by hand, not deleted.
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
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	SELECT * INTO a FROM "public"."audit_log"
		WHERE id = p_token AND user_id = uid AND actor = 'assistant'
			AND table_name IN ('transactions', 'budgets', 'accounts', 'categories');
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

REVOKE ALL ON FUNCTION "public"."assistant_create_account"(uuid, text, text, text, bigint) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."assistant_update_account"(uuid, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."assistant_create_category"(uuid, text, text, uuid) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."assistant_update_category"(uuid, jsonb) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_create_account"(uuid, text, text, text, bigint) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_update_account"(uuid, jsonb) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_create_category"(uuid, text, text, uuid) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_update_category"(uuid, jsonb) TO authenticated;
