import type { Metadata, Viewport } from "next";
import "@xterm/xterm/css/xterm.css";
import "./globals.css";
import { ReactQueryProvider } from "@/components/providers/ReactQueryProvider";
import { AppChrome } from "@/components/AppChrome";
import { ThemeInit } from "@/components/ThemeInit";
import { PWARegister } from "@/components/PWARegister";

export const metadata: Metadata = {
  title: "RobotCloud Platform",
  description: "Unified robotics intelligence workspace",
  applicationName: "RobotCloud",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "RobotCloud"
  },
  formatDetection: {
    telephone: false
  },
  icons: {
    icon: [
      { url: "/icon.png", sizes: "any" },
      { url: "/favicon.ico", type: "image/x-icon" }
    ],
    apple: [{ url: "/icons/pwa-192.png", sizes: "192x192", type: "image/png" }]
  },
  other: {
    "mobile-web-app-capable": "yes"
  }
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" }
  ]
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeInit />
        <PWARegister />
        <ReactQueryProvider>
          <AppChrome>{children}</AppChrome>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
