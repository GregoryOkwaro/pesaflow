import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PesaFlow — Cash flow budget for Kenya", template: "%s · PesaFlow" },
  description: "Plan your money day by day across M-Pesa and bank accounts. Know today if you'll run short next week.",
  icons: { icon: "/icon.svg" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f7b3f" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1411" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
