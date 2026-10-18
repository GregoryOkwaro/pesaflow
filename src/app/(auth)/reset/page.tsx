import { AuthForm } from "@/components/AuthForm";
import { env } from "@/server/env";

export const metadata = { title: "Reset password" };

export default function Page() {
  return <AuthForm mode="reset" turnstileSiteKey={env().TURNSTILE_SITE_KEY} />;
}
