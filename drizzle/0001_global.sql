ALTER TABLE "payments" ALTER COLUMN "amount" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "currency" text DEFAULT 'KES' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "currency" text DEFAULT 'KES' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "country" text DEFAULT 'KE' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" text DEFAULT 'Africa/Nairobi' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paddle_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paddle_subscription_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paddle_subscription_status" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paddle_manage_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paddle_cancel_url" text;--> statement-breakpoint
CREATE INDEX "users_paddle_sub_idx" ON "users" USING btree ("paddle_subscription_id");--> statement-breakpoint
-- M-Pesa amounts were stored as whole KES; every amount is now in minor units (cents).
UPDATE "payments" SET "amount" = "amount" * 100 WHERE "provider" = 'mpesa';
