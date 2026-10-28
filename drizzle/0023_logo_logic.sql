-- Brand logos on categories and bills (see 0022).
--
-- 1. Renaming something asks for its logo again: the old one may no longer fit
--    ("Rent" becoming "Netflix"). The old logo stays until the new answer is in.
-- 2. Saving a logo is not a change the person made, so it is left out of the
--    audit history, and logo data never fills up the history of real edits.

CREATE FUNCTION "public"."recheck_logo"() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
	IF NEW.name IS DISTINCT FROM OLD.name
		AND NEW.logo_checked_at IS NOT DISTINCT FROM OLD.logo_checked_at THEN
		NEW.logo_checked_at := NULL;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "categories_recheck_logo"
BEFORE UPDATE OF "name" ON "public"."categories"
FOR EACH ROW EXECUTE FUNCTION "public"."recheck_logo"();
--> statement-breakpoint
CREATE TRIGGER "recurring_rules_recheck_logo"
BEFORE UPDATE OF "name" ON "public"."recurring_rules"
FOR EACH ROW EXECUTE FUNCTION "public"."recheck_logo"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "public"."audit_row"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	uid uuid;
	rid uuid;
	before_row jsonb;
	after_row jsonb;
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
	-- Logos are decoration: never recorded, and an update that only touched them
	-- (or the bookkeeping around them) is not an event.
	IF TG_OP <> 'INSERT' THEN
		before_row := to_jsonb(OLD) - 'logo' - 'logo_checked_at';
	END IF;
	IF TG_OP <> 'DELETE' THEN
		after_row := to_jsonb(NEW) - 'logo' - 'logo_checked_at';
	END IF;
	IF TG_OP = 'UPDATE'
		AND (before_row - 'updated_at') = (after_row - 'updated_at')
		AND (
			(to_jsonb(OLD) -> 'logo') IS DISTINCT FROM (to_jsonb(NEW) -> 'logo')
			OR (to_jsonb(OLD) -> 'logo_checked_at') IS DISTINCT FROM (to_jsonb(NEW) -> 'logo_checked_at')
		) THEN
		RETURN NULL;
	END IF;
	INSERT INTO "public"."audit_log"
		("user_id", "table_name", "row_id", "action", "before", "after", "actor")
	VALUES (
		uid,
		TG_TABLE_NAME,
		rid,
		lower(TG_OP),
		before_row,
		after_row,
		COALESCE(NULLIF(current_setting('app.actor', true), ''), 'user')
	);
	RETURN NULL;
END;
$$;
