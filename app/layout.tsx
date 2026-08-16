import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return {
    metadataBase: new URL(`${protocol}://${host}`),
    title: "Nazraa Control",
    description: "Secure operations platform for Nazraa Live.",
    robots: { index: false, follow: false },
    openGraph: { title: "Nazraa Control", description: "Secure live operations", images: [{ url: "/og.png", width: 1731, height: 909, alt: "Nazraa Control secure live operations" }] },
    twitter: { card: "summary_large_image", title: "Nazraa Control", description: "Secure live operations", images: ["/og.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
