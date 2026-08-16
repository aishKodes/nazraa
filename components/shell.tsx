"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Activity, BadgeIndianRupee, Bell, Building2, CircleHelp, ClipboardList, Coins, FileBarChart, Gauge, Gift, Images, Landmark, LayoutDashboard, LogOut, Menu, Network, Radio, ReceiptText, Search, Settings, ShieldAlert, UserCog, Users, WalletCards, X } from "lucide-react";
import { signOut } from "@/app/actions";
import { can, type Permission } from "@/lib/auth/permissions";
import { initials } from "@/lib/utils/format";
import type { SessionAccount } from "@/types/platform";

type NavItem = { href: Route; label: string; icon: typeof LayoutDashboard; permission: Permission };

const navigation: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, permission: "dashboard.read" },
  { href: "/dashboard/accounts", label: "Team accounts", icon: UserCog, permission: "accounts.read" },
  { href: "/dashboard/users", label: "Users", icon: Users, permission: "users.read" },
  { href: "/dashboard/hosts", label: "Hosts", icon: Activity, permission: "hosts.read" },
  { href: "/dashboard/agencies", label: "Agencies", icon: Building2, permission: "agencies.read" },
  { href: "/dashboard/hierarchy", label: "Hierarchy", icon: Network, permission: "hierarchy.read" },
  { href: "/dashboard/wallet", label: "Wallet & economy", icon: WalletCards, permission: "wallet.read" },
  { href: "/dashboard/transactions", label: "Transactions", icon: ReceiptText, permission: "transactions.read" },
  { href: "/dashboard/withdrawals", label: "Withdrawals", icon: Landmark, permission: "withdrawals.read" },
  { href: "/dashboard/rooms", label: "Live rooms", icon: Radio, permission: "rooms.read" },
  { href: "/dashboard/gifts", label: "Gifts", icon: Gift, permission: "gifts.read" },
  { href: "/dashboard/banners", label: "Banners", icon: Images, permission: "banners.read" },
  { href: "/dashboard/notifications", label: "Notifications", icon: Bell, permission: "notifications.read" },
  { href: "/dashboard/reports", label: "Reports", icon: FileBarChart, permission: "reports.export" },
  { href: "/dashboard/audit", label: "Audit log", icon: ClipboardList, permission: "audit.read" },
  { href: "/dashboard/risk", label: "Risk queue", icon: ShieldAlert, permission: "risk.read" },
  { href: "/dashboard/support", label: "Support", icon: CircleHelp, permission: "support.read" },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, permission: "settings.manage" },
];

function roleLabel(role: string) {
  return role.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function AppShell({ account, children }: { account: SessionAccount; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const visibleItems = navigation.filter((item) => can(account.role, item.permission));
  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  return <div className="app-shell">
    <button className={`sidebar-scrim ${menuOpen ? "visible" : ""}`} type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />
    <aside className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Main menu">
      <div className="sidebar-brand-row"><Link href="/dashboard" className="brand" aria-label="Nazraa Control home"><span className="brand-mark">N</span><span>Nazraa <em>Control</em></span></Link><button className="sidebar-close" type="button" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={20} /></button></div>
      <nav aria-label="Primary navigation">
        <p className="nav-caption">Workspace</p>
        {visibleItems.map((item) => { const Icon = item.icon; const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href); return <Link href={item.href} key={item.href} className={`nav-link ${active ? "active" : ""}`} onClick={() => setMenuOpen(false)}><Icon size={18} /><span>{item.label}</span></Link>; })}
      </nav>
      <div className="sidebar-bottom">
        <div className="account-chip"><span className="avatar small">{initials(account.fullName)}</span><span><b>{account.fullName}</b><small>{roleLabel(account.role)}</small></span></div>
        <form action={signOut}><button className="signout" type="submit"><LogOut size={16} />Sign out</button></form>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <button className="mobile-menu" type="button" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
        <form className="quick-search" action="/dashboard/users"><Search size={18} /><input ref={searchRef} name="q" aria-label="Global user search" placeholder="Search name or user ID" /><kbd>⌘ K</kbd></form>
        <div className="top-actions"><Link href="/dashboard/notifications" className="icon-button" aria-label="Notifications"><Bell size={19} /></Link><span className="role-context"><Gauge size={16} />{roleLabel(account.role)}</span></div>
      </header>
      <div className="page-content">{children}</div>
    </main>
  </div>;
}

export function CoinsIcon() { return <Coins size={20} />; }

export function RupeeIcon() { return <BadgeIndianRupee size={20} />; }
