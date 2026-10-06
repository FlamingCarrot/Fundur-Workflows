import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { StudioProvider } from "@/components/providers/StudioProvider";
import { Overlays } from "@/components/shell/Overlays";
import "./globals.css";

// One variable grotesk for interface and headlines (headlines use its wide cut)
// and a monospace for annotations, numbers and labels.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-archivo",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono-face",
});

export const metadata: Metadata = {
  title: "Fundur",
  description: "Run every project through a clear, AI-assisted process, one focused step at a time.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#111316" },
    { media: "(prefers-color-scheme: dark)", color: "#070809" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${mono.variable}`}>
      <body>
        <StudioProvider>
          {children}
          <Overlays />
        </StudioProvider>
      </body>
    </html>
  );
}
