import { EmptyState } from "@/components/ui/misc";

export function NoWorkspace() {
  return <EmptyState title="No workspace available" description="Your account has not been added to a workspace yet, or the only workspace is restricted. Confirm adult access in Security settings, or ask the owner to add you." action={{ href: "/settings/security", label: "Open security settings" }} />;
}
