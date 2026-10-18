import { AuthForm } from "@/components/AuthForm";
import { env } from "@/server/env";

export const metadata = { title: "Create account" };

export default function Page() {
  return <AuthForm mode="signup" turnstileSiteKey={env().TURNSTILE_SITE_KEY} />;
}
