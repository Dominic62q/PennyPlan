-- Recurring rules: triggers ------------------------------------------------
CREATE TRIGGER "recurring_rules_set_updated_at"
BEFORE UPDATE ON "public"."recurring_rules"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "recurring_rules_audit"
AFTER INSERT OR UPDATE OR DELETE ON "public"."recurring_rules"
FOR EACH ROW EXECUTE FUNCTION "public"."audit_row"();
--> statement-breakpoint

-- The occurrence after a given one -------------------------------------------
-- Weekly adds whole weeks. Monthly and yearly add whole months and land on the
-- anchor day, or the last day of a shorter month, so a rule set for the 31st
-- goes 31 Jan, 28 Feb, 31 Mar instead of drifting to the 28th for good.
CREATE FUNCTION "public"."recurring_advance"(
	"p_due" date,
	"p_frequency" text,
	"p_every" integer,
	"p_anchor_day" integer
) RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
	first_of_month date;
	last_day integer;
BEGIN
	IF p_frequency = 'weekly' THEN
		RETURN p_due + (7 * p_every);
	END IF;
	first_of_month := (
		date_trunc('month', p_due::timestamp)
		+ make_interval(months => CASE WHEN p_frequency = 'yearly' THEN 12 * p_every ELSE p_every END)
	)::date;
	last_day := extract(day FROM (first_of_month + interval '1 month' - interval '1 day'))::integer;
	RETURN first_of_month + (least(p_anchor_day, last_day) - 1);
END;
$$;
--> statement-breakpoint

-- Post everything that has fallen due ------------------------------------------
-- Called whenever the app opens. Rules set to auto-post become real
-- transactions dated on the day they were due, including any days missed while
-- the app was closed. Safe to call again: each occurrence has its own
-- idempotency key, so nothing is ever posted twice. Returns how many were added.
CREATE FUNCTION "public"."post_due_recurring"(
	"p_today" date DEFAULT ((now() AT TIME ZONE 'Africa/Accra')::date)
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	r record;
	due date;
	steps integer;
	added integer;
	total integer := 0;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;

	FOR r IN
		SELECT * FROM "public"."recurring_rules"
		WHERE user_id = uid
			AND auto_post
			AND paused_at IS NULL
			AND next_due <= p_today
			AND (end_date IS NULL OR next_due <= end_date)
		ORDER BY next_due
		FOR UPDATE
	LOOP
		due := r.next_due;
		steps := 0;
		-- The step limit keeps one very old rule from running away; the rest is
		-- picked up the next time round.
		WHILE due <= p_today AND (r.end_date IS NULL OR due <= r.end_date) AND steps < 366 LOOP
			INSERT INTO "public"."transactions" (
				"user_id", "account_id", "type", "amount", "currency", "occurred_at",
				"category_id", "payee", "source", "idempotency_key"
			) VALUES (
				uid, r.account_id, r.kind, r.amount, r.currency,
				(due + time '12:00') AT TIME ZONE 'Africa/Accra',
				r.category_id, r.name, 'recurring', 'rec:' || r.id || ':' || due
			)
			ON CONFLICT ("user_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL
			DO NOTHING;
			GET DIAGNOSTICS added = ROW_COUNT;
			total := total + added;
			due := "public"."recurring_advance"(due, r.frequency, r.repeat_every, r.anchor_day);
			steps := steps + 1;
		END LOOP;
		UPDATE "public"."recurring_rules" SET next_due = due WHERE id = r.id;
	END LOOP;

	RETURN total;
END;
$$;
--> statement-breakpoint

-- Mark a bill as paid ---------------------------------------------------------
-- Posts the due occurrence (for the usual amount, or the amount actually paid)
-- and moves the rule on. Returns null when that occurrence was already dealt
-- with, for example by a second tap or another device.
CREATE FUNCTION "public"."pay_recurring"(
	"p_rule" uuid,
	"p_due" date,
	"p_amount" bigint DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	r "public"."recurring_rules"%ROWTYPE;
	tid uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;

	SELECT * INTO r FROM "public"."recurring_rules"
	WHERE id = p_rule AND user_id = uid
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'That bill no longer exists' USING ERRCODE = 'no_data_found';
	END IF;
	IF r.next_due <> p_due THEN
		RETURN NULL;
	END IF;

	INSERT INTO "public"."transactions" (
		"user_id", "account_id", "type", "amount", "currency", "occurred_at",
		"category_id", "payee", "source", "idempotency_key"
	) VALUES (
		uid, r.account_id, r.kind, COALESCE(p_amount, r.amount), r.currency, now(),
		r.category_id, r.name, 'recurring', 'rec:' || r.id || ':' || p_due
	)
	ON CONFLICT ("user_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL
	DO NOTHING
	RETURNING id INTO tid;

	UPDATE "public"."recurring_rules"
	SET next_due = "public"."recurring_advance"(p_due, r.frequency, r.repeat_every, r.anchor_day)
	WHERE id = r.id;
	RETURN tid;
END;
$$;
--> statement-breakpoint

-- Skip one occurrence without recording anything --------------------------------
CREATE FUNCTION "public"."skip_recurring"(
	"p_rule" uuid,
	"p_due" date
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	r "public"."recurring_rules"%ROWTYPE;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;

	SELECT * INTO r FROM "public"."recurring_rules"
	WHERE id = p_rule AND user_id = uid
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'That bill no longer exists' USING ERRCODE = 'no_data_found';
	END IF;
	IF r.next_due <> p_due THEN
		RETURN false;
	END IF;

	UPDATE "public"."recurring_rules"
	SET next_due = "public"."recurring_advance"(p_due, r.frequency, r.repeat_every, r.anchor_day)
	WHERE id = r.id;
	RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."recurring_advance"(date, text, integer, integer) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."post_due_recurring"(date) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."pay_recurring"(uuid, date, bigint) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."skip_recurring"(uuid, date) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."recurring_advance"(date, text, integer, integer) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."post_due_recurring"(date) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."pay_recurring"(uuid, date, bigint) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."skip_recurring"(uuid, date) TO authenticated;
