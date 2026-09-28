import { redirect } from "next/navigation";

/** Keep bookmarks and links from older app versions working. */
export default function ComputersPage() {
  redirect("/settings/computers");
}
