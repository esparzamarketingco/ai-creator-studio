export const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/studio", label: "Content Studio", icon: "M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3" },
  { href: "/approval", label: "Approval Inbox", icon: "M5 12l4 4L19 6" },
  { href: "/calendar", label: "Calendar", icon: "M4 6h16v14H4zM4 10h16M9 3v4M15 3v4" },
  { href: "/library", label: "Media Library", icon: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5" },
  { href: "/analytics", label: "Growth Analytics", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
] as const;

export const SETTINGS_NAV = [
  { href: "/settings/brand", label: "Brand & Identity", icon: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" },
  { href: "/settings/integrations", label: "Integrations", icon: "M9 7V3M15 7V3M7 7h10v5a5 5 0 01-10 0V7zM12 17v4" },
  { href: "/settings/security", label: "Security & Audit", icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" },
] as const;
