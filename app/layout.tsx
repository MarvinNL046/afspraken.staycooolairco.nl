import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StayCool Airco - Afspraak Maken",
  description: "Plan online een afspraak voor installatie, onderhoud of reparatie van uw airconditioning. Professionele service in Amsterdam en omstreken.",
  keywords: "airco, airconditioning, installatie, onderhoud, reparatie, amsterdam, staycool",
  openGraph: {
    title: "StayCool Airco - Afspraak Maken",
    description: "Plan online een afspraak voor airconditioning services",
    type: "website",
    locale: "nl_NL",
    siteName: "StayCool Airco",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
