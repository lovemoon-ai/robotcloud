import type { Metadata } from "next";
import "./globals.css";
import { ReactQueryProvider } from "@/components/providers/ReactQueryProvider";
import { AppChrome } from "@/components/AppChrome";

export const metadata: Metadata = {
  title: "RobotCloud Platform",
  description: "Unified robotics intelligence workspace"
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
