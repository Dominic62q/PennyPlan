-- New accounts start empty: no starter account and no starter categories.
CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
	INSERT INTO "public"."profiles" ("user_id", "display_name")
	VALUES (NEW.id, NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''))
	ON CONFLICT ("user_id") DO NOTHING;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP FUNCTION "public"."seed_user_defaults"(uuid);
--> statement-breakpoint

-- Remove the starter rows already created for existing people, but only where
-- they were never used or changed: no transactions at all for that person, and
-- the row's updated_at still equals created_at. Anything a person has touched
-- is left alone.
DO $$
BEGIN
	PERFORM set_config('app.skip_audit', '1', true);

	DELETE FROM "public"."categories" c
	WHERE c.parent_id IS NOT NULL
		AND c.updated_at = c.created_at
		AND NOT EXISTS (SELECT 1 FROM "public"."transactions" t WHERE t.user_id = c.user_id);

	DELETE FROM "public"."categories" c
	WHERE c.parent_id IS NULL
		AND c.updated_at = c.created_at
		AND NOT EXISTS (SELECT 1 FROM "public"."transactions" t WHERE t.user_id = c.user_id)
		AND NOT EXISTS (SELECT 1 FROM "public"."categories" k WHERE k.parent_id = c.id);

	DELETE FROM "public"."accounts" a
	WHERE a.name = 'Cash'
		AND a.type = 'cash'
		AND a.opening_balance = 0
		AND a.updated_at = a.created_at
		AND NOT EXISTS (SELECT 1 FROM "public"."transactions" t WHERE t.user_id = a.user_id);

	PERFORM set_config('app.skip_audit', '', true);
END;
$$;
