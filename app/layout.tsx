import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ViralPulse X — AI growth intelligence for journalists and creators",
  description:
    "Spot tomorrow’s stories today. Sharp drafts in your voice. A home for your work that isn’t someone else’s timeline.",
  manifest: "/brand/icons/site.webmanifest",
  icons: {
    // SVG first — modern browsers prefer it; PNG/ICO fall back for the rest.
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/icons/favicon.ico", sizes: "any" },
    ],
    apple: { url: "/brand/icons/apple-touch-icon.png", sizes: "180x180" },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gray-950 text-white">
        <Nav />
        {children}
      </body>
    </html>
  );
}
