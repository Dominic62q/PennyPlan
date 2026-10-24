-- Deleting for the assistant ----------------------------------------------------
-- Only ever called after the person taps Delete on a confirm card. Rows are
-- hidden (soft delete), never removed, so each one gets an undo token like any
-- other assistant change. Transfers are left alone.
CREATE FUNCTION "public"."assistant_delete_transactions"("p_ids" uuid[]) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	changed integer;
	tokens jsonb;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF coalesce(cardinality(p_ids), 0) = 0 THEN
		RAISE EXCEPTION 'Nothing to delete.';
	END IF;
	IF cardinality(p_ids) > 20 THEN
		RAISE EXCEPTION 'That is too many to delete at once.';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);

	UPDATE "public"."transactions"
	SET "deleted_at" = now()
	WHERE "id" = ANY (p_ids)
		AND "user_id" = uid
		AND "transfer_group_id" IS NULL
		AND "deleted_at" IS NULL;
	GET DIAGNOSTICS changed = ROW_COUNT;

	SELECT coalesce(jsonb_agg(id), '[]'::jsonb) INTO tokens FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'transactions' AND row_id = ANY (p_ids)
			AND action = 'update' AND actor = 'assistant' AND created_at = now();

	RETURN jsonb_build_object('count', changed, 'undo_tokens', tokens);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."assistant_delete_transactions"(uuid[]) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_delete_transactions"(uuid[]) TO authenticated;
