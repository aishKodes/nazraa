import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

const links = [
  ["Privacy", "/privacy"], ["Terms", "/terms"], ["Guidelines", "/community-guidelines"],
  ["Child Safety", "/child-safety"], ["Delete Account", "/account-deletion"],
  ["Support", "/support"], ["Refunds", "/refunds"], ["Copyright", "/copyright"],
] as const;

export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-screen bg-slate-950 text-slate-100">
    <header className="border-b border-white/10 bg-slate-950/95">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-5 py-5">
        <Link href="/privacy" className="text-xl font-semibold tracking-tight">Nazraa Live</Link>
        <Link href="/support" className="rounded-full bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white">Contact support</Link>
      </div>
    </header>
    <main>{children}</main>
    <footer className="mt-16 border-t border-white/10 bg-slate-950">
      <div className="mx-auto max-w-5xl px-5 py-8">
        <nav className="flex flex-wrap gap-x-5 gap-y-3 text-sm text-slate-300">
          {links.map(([label, href]) => <Link key={href} href={href} className="hover:text-white">{label}</Link>)}
        </nav>
        <p className="mt-6 text-sm text-slate-400">© 2026 Nazraa Live. Support and legal requests are handled through the monitored Nazraa Support route.</p>
      </div>
    </footer>
  </div>;
}
