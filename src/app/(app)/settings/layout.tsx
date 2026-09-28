import { SettingsShell } from "@/components/views/settings";
import { settingsMenu } from "@/lib/settings-menu";
import { MODE, authState } from "@/server/supabase";

/** Settings' menu stays while its pages change; which pages it has depends on the account and the app. */
export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const state = await authState();
  return <SettingsShell menu={settingsMenu({ account: !!state, desktop: MODE === "desktop" })}>{children}</SettingsShell>;
}
