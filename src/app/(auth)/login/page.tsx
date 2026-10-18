import { AuthForm } from "@/components/AuthForm";
import { env } from "@/server/env";

export const metadata = { title: "Log in" };

export default function Page() {
  return <AuthForm mode="login" turnstileSiteKey={env().TURNSTILE_SITE_KEY} />;
}
