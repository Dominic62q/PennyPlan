CREATE TABLE "assistant_chats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"messages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_chats_title_chk" CHECK (char_length("assistant_chats"."title") between 1 and 80),
	CONSTRAINT "assistant_chats_messages_chk" CHECK (jsonb_typeof("assistant_chats"."messages") = 'array' and pg_column_size("assistant_chats"."messages") <= 400000)
);
--> statement-breakpoint
ALTER TABLE "assistant_chats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistant_chats" ADD CONSTRAINT "assistant_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_chats_user_updated_idx" ON "assistant_chats" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "assistant_chats_select_own" ON "assistant_chats" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("assistant_chats"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "assistant_chats_insert_own" ON "assistant_chats" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("assistant_chats"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "assistant_chats_update_own" ON "assistant_chats" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("assistant_chats"."user_id" = (select auth.uid())) WITH CHECK ("assistant_chats"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "assistant_chats_delete_own" ON "assistant_chats" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("assistant_chats"."user_id" = (select auth.uid()));
--> statement-breakpoint
CREATE TRIGGER "assistant_chats_set_updated_at"
BEFORE UPDATE ON "public"."assistant_chats"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();
