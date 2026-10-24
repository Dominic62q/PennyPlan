-- Assistant usage: counting a model call against the daily limits ----------------
-- Called only from the server's own database connection. Execute is taken away
-- from the API roles below, so nobody can call it through the browser and
-- burn the shared daily allowance.

CREATE FUNCTION "public"."reserve_assistant_call"(
  p_user uuid,
  p_global_cap integer,
  p_user_cap integer DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_calls integer;
BEGIN
  -- Everyone's shared count first. The WHERE makes the increment refuse once the
  -- cap is reached, atomically, so two requests can't both take the last call.
  INSERT INTO "public"."assistant_usage" AS u (day, subject, calls)
  VALUES (v_day, 'global', 1)
  ON CONFLICT (day, subject) DO UPDATE SET calls = u.calls + 1
    WHERE u.calls < p_global_cap
  RETURNING u.calls INTO v_calls;
  IF v_calls IS NULL THEN
    RETURN 'global_cap';
  END IF;

  INSERT INTO "public"."assistant_usage" AS u (day, subject, calls)
  VALUES (v_day, p_user::text, 1)
  ON CONFLICT (day, subject) DO UPDATE SET calls = u.calls + 1
    WHERE p_user_cap IS NULL OR u.calls < p_user_cap
  RETURNING u.calls INTO v_calls;
  IF v_calls IS NULL THEN
    -- This person is at their own limit: give the shared call back.
    UPDATE "public"."assistant_usage"
       SET calls = calls - 1
     WHERE day = v_day AND subject = 'global';
    RETURN 'user_cap';
  END IF;

  RETURN 'ok';
END;
$$;
--> statement-breakpoint

CREATE FUNCTION "public"."record_assistant_tokens"(p_user uuid, p_tokens bigint)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO "public"."assistant_usage" AS u (day, subject, tokens)
  SELECT (now() AT TIME ZONE 'utc')::date, s, p_tokens
    FROM unnest(ARRAY['global', p_user::text]) AS s
  ON CONFLICT (day, subject) DO UPDATE SET tokens = u.tokens + p_tokens;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION "public"."reserve_assistant_call"(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."record_assistant_tokens"(uuid, bigint) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE "public"."assistant_usage" FROM anon, authenticated;
