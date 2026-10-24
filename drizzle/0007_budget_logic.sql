-- Budgets: triggers --------------------------------------------------------
CREATE TRIGGER "budgets_set_updated_at"
BEFORE UPDATE ON "public"."budgets"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "budgets_audit"
AFTER INSERT OR UPDATE OR DELETE ON "public"."budgets"
FOR EACH ROW EXECUTE FUNCTION "public"."audit_row"();
--> statement-breakpoint

-- Set or change a budget in one call ------------------------------------------
-- A null category is the overall monthly budget. Safe to repeat.
CREATE FUNCTION "public"."set_budget"(
	"p_category" uuid,
	"p_amount" bigint,
	"p_currency" text DEFAULT 'GHS'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
	uid uuid := "auth"."uid"();
	bid uuid;
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'invalid_authorization_specification';
	END IF;

	UPDATE "public"."budgets"
	SET amount = p_amount, currency = p_currency
	WHERE user_id = uid AND category_id IS NOT DISTINCT FROM p_category
	RETURNING id INTO bid;

	IF bid IS NULL THEN
		INSERT INTO "public"."budgets" ("user_id", "category_id", "amount", "currency")
		VALUES (uid, p_category, p_amount, p_currency)
		RETURNING id INTO bid;
	END IF;
	RETURN bid;
END;
$$;
--> statement-breakpoint

-- Budget progress for a month -----------------------------------------------
-- Spent is worked out from live transactions every time, never stored. A
-- category budget counts its subcategories; the overall budget counts every
-- expense. Months follow Ghana time.
CREATE FUNCTION "public"."budget_progress"("p_month" date DEFAULT current_date)
RETURNS TABLE (
	"budget_id" uuid,
	"category_id" uuid,
	"amount" bigint,
	"currency" text,
	"spent" bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
	WITH bounds AS (
		SELECT
			(date_trunc('month', p_month::timestamp)) AT TIME ZONE 'Africa/Accra' AS s,
			(date_trunc('month', p_month::timestamp) + interval '1 month') AT TIME ZONE 'Africa/Accra' AS e
	), spend AS (
		SELECT
			t.currency,
			t.category_id,
			COALESCE(c.parent_id, c.id) AS top_id,
			t.amount
		FROM "public"."transactions" t
		LEFT JOIN "public"."categories" c ON c.id = t.category_id
		CROSS JOIN bounds
		WHERE t.user_id = "auth"."uid"()
			AND t.type = 'expense'
			AND t.deleted_at IS NULL
			AND t.occurred_at >= bounds.s
			AND t.occurred_at < bounds.e
	)
	SELECT
		b.id,
		b.category_id,
		b.amount,
		b.currency,
		COALESCE((
			SELECT sum(s.amount) FROM spend s
			WHERE s.currency = b.currency
				AND (b.category_id IS NULL
					OR s.category_id = b.category_id
					OR s.top_id = b.category_id)
		), 0)::bigint
	FROM "public"."budgets" b
	WHERE b.user_id = "auth"."uid"()
	ORDER BY b.category_id NULLS FIRST, b.created_at
$$;
--> statement-breakpoint

-- Monthly report ---------------------------------------------------------------
-- Everything the Reports screen (and later the assistant) needs for one month
-- in one round trip: totals, last month for comparison, spending by top-level
-- category, spending per day, and a six month trend. Transfers are not income
-- or spending, so they are left out.
CREATE FUNCTION "public"."monthly_report"(
	"p_month" date DEFAULT current_date,
	"p_currency" text DEFAULT 'GHS'
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
	WITH m AS (
		SELECT date_trunc('month', p_month::timestamp) AS ms
	), tx AS (
		SELECT
			t.type,
			t.amount,
			t.category_id,
			COALESCE(c.parent_id, c.id) AS top_id,
			(t.occurred_at AT TIME ZONE 'Africa/Accra') AS local_at
		FROM "public"."transactions" t
		LEFT JOIN "public"."categories" c ON c.id = t.category_id
		CROSS JOIN m
		WHERE t.user_id = "auth"."uid"()
			AND t.deleted_at IS NULL
			AND t.currency = p_currency
			AND t.type IN ('expense', 'income')
			AND t.occurred_at >= (m.ms - interval '5 months') AT TIME ZONE 'Africa/Accra'
			AND t.occurred_at < (m.ms + interval '1 month') AT TIME ZONE 'Africa/Accra'
	), this_month AS (
		SELECT tx.* FROM tx, m WHERE tx.local_at >= m.ms AND tx.local_at < m.ms + interval '1 month'
	), last_month AS (
		SELECT tx.* FROM tx, m
		WHERE tx.local_at >= m.ms - interval '1 month' AND tx.local_at < m.ms
	)
	SELECT jsonb_build_object(
		'month', to_char((SELECT ms FROM m), 'YYYY-MM-DD'),
		'currency', p_currency,
		'income', COALESCE((SELECT sum(amount) FROM this_month WHERE type = 'income'), 0),
		'expense', COALESCE((SELECT sum(amount) FROM this_month WHERE type = 'expense'), 0),
		'count', (SELECT count(*) FROM this_month),
		'prev_income', COALESCE((SELECT sum(amount) FROM last_month WHERE type = 'income'), 0),
		'prev_expense', COALESCE((SELECT sum(amount) FROM last_month WHERE type = 'expense'), 0),
		'categories', COALESCE((
			SELECT jsonb_agg(to_jsonb(r) ORDER BY r.amount DESC, r.name)
			FROM (
				SELECT
					g.top_id AS category_id,
					COALESCE(c.name, 'Uncategorised') AS name,
					c.icon,
					c.color,
					g.amount,
					g.count
				FROM (
					SELECT top_id, sum(amount)::bigint AS amount, count(*)::int AS count
					FROM this_month
					WHERE type = 'expense'
					GROUP BY top_id
				) g
				LEFT JOIN "public"."categories" c ON c.id = g.top_id
			) r
		), '[]'::jsonb),
		'daily', COALESCE((
			SELECT jsonb_agg(jsonb_build_object('day', d.day, 'amount', d.amount) ORDER BY d.day)
			FROM (
				SELECT
					to_char(gs.day, 'YYYY-MM-DD') AS day,
					COALESCE(sum(tm.amount), 0)::bigint AS amount
				FROM m,
					generate_series(m.ms, m.ms + interval '1 month' - interval '1 day', interval '1 day') AS gs(day)
				LEFT JOIN this_month tm
					ON tm.type = 'expense' AND tm.local_at::date = gs.day::date
				GROUP BY gs.day
			) d
		), '[]'::jsonb),
		'trend', COALESCE((
			SELECT jsonb_agg(
				jsonb_build_object('month', y.month, 'income', y.income, 'expense', y.expense)
				ORDER BY y.month
			)
			FROM (
				SELECT
					to_char(gs.month, 'YYYY-MM-DD') AS month,
					COALESCE(sum(tx.amount) FILTER (WHERE tx.type = 'income'), 0)::bigint AS income,
					COALESCE(sum(tx.amount) FILTER (WHERE tx.type = 'expense'), 0)::bigint AS expense
				FROM m,
					generate_series(m.ms - interval '5 months', m.ms, interval '1 month') AS gs(month)
				LEFT JOIN tx
					ON date_trunc('month', tx.local_at) = gs.month
				GROUP BY gs.month
			) y
		), '[]'::jsonb)
	)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."set_budget"(uuid, bigint, text) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."budget_progress"(date) FROM PUBLIC, anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."monthly_report"(date, text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."set_budget"(uuid, bigint, text) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."budget_progress"(date) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."monthly_report"(date, text) TO authenticated;
