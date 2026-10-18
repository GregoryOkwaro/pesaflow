CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"budget_id" uuid NOT NULL,
	"name" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"include_in_total" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"horizon_days" integer DEFAULT 31 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"budget_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"every_days" integer DEFAULT 0 NOT NULL,
	"value_date" date,
	"end_date" date,
	"tie_to" uuid,
	"done" boolean DEFAULT false NOT NULL,
	"account_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"salt" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"plan" text NOT NULL,
	"amount" integer NOT NULL,
	"phone" text NOT NULL,
	"provider_ref" text,
	"merchant_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_code" text,
	"result_desc" text,
	"receipt" text,
	"applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"trial_ends_at" date NOT NULL,
	"paid_until" date,
	"reminder_sent_for" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_tie_to_items_id_fk" FOREIGN KEY ("tie_to") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_budget_idx" ON "accounts" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "budgets_user_idx" ON "budgets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "items_budget_idx" ON "items" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_key" ON "payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_receipt_key" ON "payments" USING btree ("provider","receipt");--> statement-breakpoint
CREATE INDEX "payments_pending_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");