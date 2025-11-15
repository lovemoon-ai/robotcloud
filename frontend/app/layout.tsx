import type { Metadata } from "next";
import "./globals.css";
import { ReactQueryProvider } from "@/components/providers/ReactQueryProvider";
import { AppChrome } from "@/components/AppChrome";

export const metadata: Metadata = {
  title: "RobotCloud Platform",
  description: "Unified robotics intelligence workspace",
  icons: {
    icon: [
      { url: "/icon.png", sizes: "any" },
      { url: "/favicon.ico", type: "image/x-icon" }
    ]
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ReactQueryProvider>
          <AppChrome>{children}</AppChrome>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
