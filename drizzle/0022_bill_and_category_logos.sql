ALTER TABLE "categories" ADD COLUMN "logo" jsonb;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "logo_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD COLUMN "logo" jsonb;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD COLUMN "logo_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_logo_chk" CHECK ("categories"."logo" is null or (
      jsonb_typeof("categories"."logo") = 'object'
      and char_length(coalesce("categories"."logo"->>'title', '')) between 1 and 80
      and (
        coalesce("categories"."logo"->>'path' ~ '^[MmLlHhVvCcSsQqTtAaZz0-9 .,eE+-]+$' and char_length("categories"."logo"->>'path') <= 60000, false)
        or coalesce("categories"."logo"->>'image' ~ '^data:image/png[^A-Za-z0-9]base64,[A-Za-z0-9+/]+={0,2}$' and char_length("categories"."logo"->>'image') <= 20100, false)
      )
    ));--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_logo_chk" CHECK ("recurring_rules"."logo" is null or (
      jsonb_typeof("recurring_rules"."logo") = 'object'
      and char_length(coalesce("recurring_rules"."logo"->>'title', '')) between 1 and 80
      and (
        coalesce("recurring_rules"."logo"->>'path' ~ '^[MmLlHhVvCcSsQqTtAaZz0-9 .,eE+-]+$' and char_length("recurring_rules"."logo"->>'path') <= 60000, false)
        or coalesce("recurring_rules"."logo"->>'image' ~ '^data:image/png[^A-Za-z0-9]base64,[A-Za-z0-9+/]+={0,2}$' and char_length("recurring_rules"."logo"->>'image') <= 20100, false)
      )
    ));