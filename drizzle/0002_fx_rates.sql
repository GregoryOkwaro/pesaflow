CREATE TABLE "fx_rates" (
	"currency" text PRIMARY KEY NOT NULL,
	"per_usd" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
