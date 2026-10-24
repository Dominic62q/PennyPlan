-- Keeps updated_at current on any table that attaches this trigger.
CREATE FUNCTION "public"."set_updated_at"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "profiles_set_updated_at"
BEFORE UPDATE ON "public"."profiles"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
-- Creates the profile when someone signs up. Runs as the function owner so it
-- works before the new user has a session.
CREATE FUNCTION "public"."handle_new_user"() RETURNS trigger
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
REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER "on_auth_user_created"
AFTER INSERT ON "auth"."users"
FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();
