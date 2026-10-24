-- Seeding must not leave auditing switched off for the rest of the transaction.
CREATE OR REPLACE FUNCTION "public"."seed_user_defaults"("p_user_id" uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
	prev_skip text := COALESCE(current_setting('app.skip_audit', true), '');
BEGIN
	IF EXISTS (SELECT 1 FROM "public"."categories" WHERE user_id = p_user_id) THEN
		RETURN;
	END IF;
	PERFORM set_config('app.skip_audit', '1', true);

	INSERT INTO "public"."accounts" ("user_id", "name", "type", "sort_order")
	VALUES (p_user_id, 'Cash', 'cash', 0)
	ON CONFLICT DO NOTHING;

	WITH parents (kind, name, icon, color, sort) AS (VALUES
		('expense', 'Food & Dining',   'utensils',       '#e8590c', 0),
		('expense', 'Transport',       'bus',            '#1c7ed6', 1),
		('expense', 'Bills & Utilities','receipt',       '#7048e8', 2),
		('expense', 'Housing',         'house',          '#0ca678', 3),
		('expense', 'Health',          'heart-pulse',    '#e03131', 4),
		('expense', 'Education',       'graduation-cap', '#3b5bdb', 5),
		('expense', 'Shopping',        'shopping-bag',   '#d6336c', 6),
		('expense', 'Entertainment',   'clapperboard',   '#f08c00', 7),
		('expense', 'Family & Gifts',  'gift',           '#c2255c', 8),
		('expense', 'Personal care',   'sparkles',       '#ae3ec9', 9),
		('expense', 'Fees & Charges',  'landmark',       '#495057', 10),
		('expense', 'Other',           'ellipsis',       '#868e96', 11),
		('income',  'Salary',          'briefcase',      '#2f9e44', 0),
		('income',  'Business income', 'store',          '#099268', 1),
		('income',  'Gifts received',  'gift',           '#c2255c', 2),
		('income',  'Interest & investments', 'trending-up', '#1098ad', 3),
		('income',  'Other income',    'ellipsis',       '#868e96', 4)
	), inserted AS (
		INSERT INTO "public"."categories" ("user_id", "name", "kind", "icon", "color", "sort_order")
		SELECT p_user_id, name, kind, icon, color, sort FROM parents
		RETURNING id, name, kind
	), subs (parent, kind, name, sort) AS (VALUES
		('Food & Dining',   'expense', 'Groceries', 0),
		('Food & Dining',   'expense', 'Restaurants & chop bars', 1),
		('Food & Dining',   'expense', 'Snacks & drinks', 2),
		('Transport',       'expense', 'Fuel', 0),
		('Transport',       'expense', 'Ride-hailing', 1),
		('Transport',       'expense', 'Trotro & bus fare', 2),
		('Transport',       'expense', 'Car maintenance', 3),
		('Bills & Utilities','expense', 'Electricity', 0),
		('Bills & Utilities','expense', 'Water', 1),
		('Bills & Utilities','expense', 'Internet & data', 2),
		('Bills & Utilities','expense', 'Airtime', 3),
		('Bills & Utilities','expense', 'TV & subscriptions', 4),
		('Housing',         'expense', 'Rent', 0),
		('Housing',         'expense', 'Repairs & maintenance', 1),
		('Health',          'expense', 'Medical', 0),
		('Health',          'expense', 'Pharmacy', 1),
		('Education',       'expense', 'School fees', 0),
		('Education',       'expense', 'Books & supplies', 1),
		('Shopping',        'expense', 'Clothing', 0),
		('Shopping',        'expense', 'Household items', 1),
		('Shopping',        'expense', 'Electronics', 2),
		('Fees & Charges',  'expense', 'Bank charges', 0),
		('Fees & Charges',  'expense', 'Mobile money fees', 1)
	)
	INSERT INTO "public"."categories" ("user_id", "name", "kind", "parent_id", "sort_order")
	SELECT p_user_id, s.name, s.kind, i.id, s.sort
	FROM subs s
	JOIN inserted i ON i.name = s.parent AND i.kind = s.kind;

	-- Put the setting back so later writes in this transaction are still audited.
	PERFORM set_config('app.skip_audit', prev_skip, true);
END;
$$;
