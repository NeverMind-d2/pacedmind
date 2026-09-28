import { SettingsShell } from "@/components/views/settings";
import { settingsMenu } from "@/lib/settings-menu";
import { readPlan } from "@/server/billing";
import { MODE, authState } from "@/server/supabase";

/** Settings' menu stays while its pages change; which pages it has depends on the account, its plan and the app. */
export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const [state, plan] = await Promise.all([authState(), readPlan()]);
  return <SettingsShell menu={settingsMenu({ account: !!state, plan: !!plan?.enforced, desktop: MODE === "desktop" })}>{children}</SettingsShell>;
}
