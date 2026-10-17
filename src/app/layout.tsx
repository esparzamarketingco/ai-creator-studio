import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AI Creator Studio", template: "%s · AI Creator Studio" },
  description: "Private creator dashboard: plan, generate, approve and publish.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#08080a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
