import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AXON Vision CMP",
  description: "Centralized monitoring platform for construction AI safety",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
