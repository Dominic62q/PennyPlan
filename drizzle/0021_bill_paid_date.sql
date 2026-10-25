-- Paying a bill (or receiving income) can say which day it really happened,
-- since it often comes after the due date. Without a day it is recorded at the
-- moment of the tap, as before. The due occurrence is still the one in the
-- idempotency key, so a late payment cannot be recorded twice.

DROP FUNCTION "public"."pay_recurring"(uuid, date, bigint);
--> statement-breakpoint
DROP FUNCTION "public"."assistant_pay_bill"(uuid, bigint);
--> statement-breakpoint

CREATE FUNCTION "public"."pay_recurring"(
	"p_rule" uuid,
	"p_due" date,
	"p_amount" bigint DEFAULT NULL,
	"p_paid_at" timestamptz DEFAULT NULL
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
	IF p_paid_at IS NOT NULL AND p_paid_at > now() + interval '1 day' THEN
		RAISE EXCEPTION 'Pick today or an earlier day.';
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
		uid, r.account_id, r.kind, COALESCE(p_amount, r.amount), r.currency, COALESCE(p_paid_at, now()),
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

CREATE FUNCTION "public"."assistant_pay_bill"(
	"p_id" uuid,
	"p_amount" bigint DEFAULT NULL,
	"p_paid_at" timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	r "public"."recurring_rules"%ROWTYPE;
	tid uuid;
	paid_for date;
	token uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;
	IF p_amount IS NOT NULL AND (p_amount < 1 OR p_amount > 99999999999999) THEN
		RAISE EXCEPTION 'That amount is out of range.';
	END IF;
	IF p_paid_at IS NOT NULL AND p_paid_at > now() + interval '1 day' THEN
		RAISE EXCEPTION 'Pick today or an earlier day.';
	END IF;
	SELECT * INTO r FROM "public"."recurring_rules" WHERE id = p_id AND user_id = uid FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'That bill was not found.' USING ERRCODE = 'no_data_found';
	END IF;
	IF r.paused_at IS NOT NULL THEN
		RAISE EXCEPTION 'That bill is paused. Resume it first.';
	END IF;
	IF r.end_date IS NOT NULL AND r.next_due > r.end_date THEN
		RAISE EXCEPTION 'That bill has ended.';
	END IF;
	IF EXISTS (SELECT 1 FROM "public"."accounts" WHERE id = r.account_id AND archived_at IS NOT NULL) THEN
		RAISE EXCEPTION 'The account for that bill is archived. Move the bill to another account first.';
	END IF;

	PERFORM set_config('app.actor', 'assistant', true);
	paid_for := r.next_due;

	INSERT INTO "public"."transactions" (
		"user_id", "account_id", "type", "amount", "currency", "occurred_at",
		"category_id", "payee", "source", "idempotency_key"
	) VALUES (
		uid, r.account_id, r.kind, COALESCE(p_amount, r.amount), r.currency, COALESCE(p_paid_at, now()),
		r.category_id, r.name, 'recurring', 'rec:' || r.id::text || ':' || paid_for::text
	)
	ON CONFLICT ("user_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL
	DO NOTHING
	RETURNING id INTO tid;
	IF tid IS NULL THEN
		RAISE EXCEPTION 'That payment was already recorded.';
	END IF;

	UPDATE "public"."recurring_rules"
		SET next_due = "public"."recurring_advance"(paid_for, r.frequency, r.repeat_every, r.anchor_day)
		WHERE id = r.id;

	SELECT id INTO token FROM "public"."audit_log"
		WHERE user_id = uid AND table_name = 'recurring_rules' AND row_id = p_id
			AND action = 'update' AND actor = 'assistant' AND created_at = now()
		LIMIT 1;

	RETURN jsonb_build_object('id', p_id, 'undo_token', token, 'transaction_id', tid, 'paid_for', paid_for);
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION "public"."pay_recurring"(uuid, date, bigint, timestamptz) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."assistant_pay_bill"(uuid, bigint, timestamptz) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."pay_recurring"(uuid, date, bigint, timestamptz) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."assistant_pay_bill"(uuid, bigint, timestamptz) TO authenticated;
