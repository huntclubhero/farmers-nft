import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Hat Pets",
  description:
    "Hat-gated, fully on-chain animated tamagotchi NFTs on Base. Tap your hat. Claim your pet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-body antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
