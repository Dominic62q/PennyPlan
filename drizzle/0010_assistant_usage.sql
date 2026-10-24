CREATE TABLE "assistant_usage" (
	"day" date NOT NULL,
	"subject" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"tokens" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "assistant_usage_day_subject_pk" PRIMARY KEY("day","subject")
);
--> statement-breakpoint
ALTER TABLE "assistant_usage" ENABLE ROW LEVEL SECURITY;