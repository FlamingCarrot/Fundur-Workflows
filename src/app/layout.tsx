import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import { StudioProvider } from "@/components/providers/StudioProvider";
import { Overlays } from "@/components/shell/Overlays";
import { usesServerPersistence } from "@/lib/server/workspace-context";
import "./globals.css";

// A characterful grotesk for headlines (optical sizes sharpen it as it grows)
// and a friendly, legible sans for everything else.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-bricolage",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "Fundur",
  description: "Run every project through a clear, AI-assisted process, one focused step at a time.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ecebe6" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${dmSans.variable}`}>
      <body>
        <StudioProvider persistence={usesServerPersistence() ? "server" : "local"}>
          {children}
          <Overlays />
        </StudioProvider>
      </body>
    </html>
  );
}
