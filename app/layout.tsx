import type { Metadata } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "needle-drop-music.shaina52.chatgpt.site";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);

  return {
    metadataBase: baseUrl,
    title: "NEEDLE / DROP — Music Blog",
    description: "Μικρό ανεξάρτητο blog με μουσικές κυκλοφορίες, tracklists και downloads.",
    openGraph: {
      title: "NEEDLE / DROP — Music Blog",
      description: "Releases, tracklists και downloads σε απλή blog μορφή.",
      images: [{ url: new URL("/og.png", baseUrl).toString(), width: 1680, height: 941 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "NEEDLE / DROP — Music Blog",
      description: "Releases, tracklists και downloads σε απλή blog μορφή.",
      images: [new URL("/og.png", baseUrl).toString()],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const GA_MEASUREMENT_ID = "G-XXXXXXXXXX"; // <-- Βάλτε εδώ το δικό σας ID

  return (
    <html lang="el" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Sedgwick+Ave+Display&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/theme.css?v=3" />
        <script src="/theme-toggle.js?v=1" />

        {/* Google Analytics */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  );
}