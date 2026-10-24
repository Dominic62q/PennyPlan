-- Spending summary ---------------------------------------------------------------
-- Totals for any date range, grouped by category, payee, account or time, for the
-- assistant. The database does the adding so the model never has to. Dates are
-- calendar days in Accra, both ends inclusive. Transfers are not spending or
-- income, so they are left out.
CREATE FUNCTION "public"."spending_summary"(
	"p_from" date,
	"p_to" date,
	"p_type" text DEFAULT 'expense',
	"p_group" text DEFAULT 'category',
	"p_currency" text DEFAULT 'GHS'
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
	WITH tx AS (
		SELECT
			t.amount,
			t.account_id,
			t.category_id,
			NULLIF(btrim(t.payee), '') AS payee,
			(t.occurred_at AT TIME ZONE 'Africa/Accra')::date AS day
		FROM "public"."transactions" t
		WHERE t.user_id = "auth"."uid"()
			AND t.deleted_at IS NULL
			AND t.currency = p_currency
			AND t.type = p_type
			AND p_type IN ('expense', 'income')
			AND (t.occurred_at AT TIME ZONE 'Africa/Accra')::date BETWEEN p_from AND p_to
	), keyed AS (
		SELECT
			tx.amount,
			CASE p_group
				WHEN 'category' THEN COALESCE(c.parent_id, c.id)::text
				WHEN 'subcategory' THEN c.id::text
				WHEN 'payee' THEN lower(tx.payee)
				WHEN 'account' THEN tx.account_id::text
				WHEN 'day' THEN to_char(tx.day, 'YYYY-MM-DD')
				WHEN 'week' THEN to_char(date_trunc('week', tx.day), 'YYYY-MM-DD')
				WHEN 'month' THEN to_char(date_trunc('month', tx.day), 'YYYY-MM')
			END AS k,
			CASE p_group
				WHEN 'category' THEN COALESCE(cp.name, 'Uncategorised')
				WHEN 'subcategory' THEN COALESCE(c.name, 'Uncategorised')
				WHEN 'payee' THEN COALESCE(tx.payee, 'No payee')
				WHEN 'account' THEN a.name
				WHEN 'day' THEN to_char(tx.day, 'YYYY-MM-DD')
				WHEN 'week' THEN to_char(date_trunc('week', tx.day), 'YYYY-MM-DD')
				WHEN 'month' THEN to_char(date_trunc('month', tx.day), 'YYYY-MM')
			END AS label,
			CASE WHEN p_group IN ('category', 'subcategory', 'account') THEN
				CASE p_group
					WHEN 'category' THEN COALESCE(c.parent_id, c.id)::text
					WHEN 'subcategory' THEN c.id::text
					ELSE tx.account_id::text
				END
			END AS id
		FROM tx
		LEFT JOIN "public"."categories" c ON c.id = tx.category_id
		LEFT JOIN "public"."categories" cp ON cp.id = COALESCE(c.parent_id, c.id)
		LEFT JOIN "public"."accounts" a ON a.id = tx.account_id
	), grouped AS (
		SELECT
			k,
			min(label) AS label,
			min(id) AS id,
			sum(amount)::bigint AS amount,
			count(*)::int AS count
		FROM keyed
		GROUP BY k
	)
	SELECT jsonb_build_object(
		'total', COALESCE((SELECT sum(amount) FROM tx), 0)::bigint,
		'count', (SELECT count(*) FROM tx)::int,
		'group_count', (SELECT count(*) FROM grouped)::int,
		'groups', COALESCE((
			SELECT jsonb_agg(
				jsonb_build_object('id', g.id, 'label', g.label, 'amount', g.amount, 'count', g.count)
				ORDER BY
					CASE WHEN p_group IN ('day', 'week', 'month') THEN g.k END,
					g.amount DESC,
					g.label
			)
			FROM (
				SELECT * FROM grouped
				ORDER BY
					CASE WHEN p_group IN ('day', 'week', 'month') THEN k END,
					amount DESC,
					label
				LIMIT 40
			) g
		), '[]'::jsonb)
	)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."spending_summary"(date, date, text, text, text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "public"."spending_summary"(date, date, text, text, text) TO authenticated;
