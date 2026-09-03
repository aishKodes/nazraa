"use client";

import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Activity, BadgeIndianRupee, Bell, Building2, CircleHelp, ClipboardList, Coins, FileBarChart, Gauge, Gift, Images, Landmark, LayoutDashboard, LogOut, Menu, Network, Radio, ReceiptText, ScanFace, Search, Settings, ShieldAlert, ShoppingBag, UserCog, Users, WalletCards, X } from "lucide-react";
import { signOut } from "@/app/actions";
import { roleLabel } from "@/lib/auth/role-hierarchy";
import { initials } from "@/lib/utils/format";
import type { Role, SessionAccount } from "@/types/platform";

type NavItem = { href: Route; label: string; icon: typeof LayoutDashboard };

const common = {
  overview: { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  accounts: { href: "/dashboard/accounts", label: "Team", icon: UserCog },
  users: { href: "/dashboard/users", label: "Users", icon: Users },
  hosts: { href: "/dashboard/hosts", label: "Hosts", icon: Activity },
  agencies: { href: "/dashboard/agencies", label: "Agencies", icon: Building2 },
  hierarchy: { href: "/dashboard/hierarchy", label: "Hierarchy", icon: Network },
  monitoring: { href: "/dashboard/monitoring", label: "Monitoring", icon: Radio },
  wallet: { href: "/dashboard/wallet", label: "Wallet & coins", icon: WalletCards },
  commerce: { href: "/dashboard/commerce", label: "Coin orders", icon: ShoppingBag },
  transactions: { href: "/dashboard/transactions", label: "Transactions", icon: ReceiptText },
  withdrawals: { href: "/dashboard/withdrawals", label: "Withdrawals", icon: Landmark },
  rooms: { href: "/dashboard/rooms", label: "Live rooms", icon: Radio },
  face: { href: "/dashboard/face-verification", label: "Verification", icon: ScanFace },
  gifts: { href: "/dashboard/gifts", label: "Gifts", icon: Gift },
  banners: { href: "/dashboard/banners", label: "Banners", icon: Images },
  notifications: { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
  reports: { href: "/dashboard/reports", label: "Reports", icon: FileBarChart },
  audit: { href: "/dashboard/audit", label: "Audit log", icon: ClipboardList },
  risk: { href: "/dashboard/risk", label: "Risk queue", icon: ShieldAlert },
  support: { href: "/dashboard/support", label: "Support", icon: CircleHelp },
  settings: { href: "/dashboard/settings", label: "Settings", icon: Settings },
} satisfies Record<string, NavItem>;

const navigationByRole: Record<Role, NavItem[]> = {
  MASTER: [common.overview, common.hierarchy, common.accounts, common.users, common.hosts, common.agencies, common.monitoring, common.wallet, common.transactions, common.withdrawals, common.rooms, common.commerce, common.face, common.reports, common.audit, common.risk, common.support, common.gifts, common.banners, common.notifications, common.settings],
  COUNTRY_MANAGER: [common.overview, common.accounts, common.hierarchy, common.users, common.hosts, common.agencies, common.monitoring, common.wallet, common.transactions, common.withdrawals, common.commerce, common.rooms, common.face, common.reports, common.audit, common.risk, common.support],
  SUPER_ADMIN: [common.overview, common.accounts, common.hierarchy, common.agencies, common.hosts, common.users, common.monitoring, common.wallet, common.transactions, common.withdrawals, common.rooms, common.face, common.reports, common.audit, common.risk, common.support],
  ADMIN: [common.overview, common.agencies, common.hosts, common.users, common.accounts, common.monitoring, common.wallet, common.transactions, common.withdrawals, common.rooms, common.face, common.reports, common.risk, common.support],
  BD: [common.overview, common.agencies, common.hosts, common.users, common.accounts, common.monitoring, common.wallet, common.transactions, common.withdrawals, common.rooms, common.face, common.reports, common.risk, common.support],
  AGENCY: [common.overview, common.agencies, common.hosts, common.monitoring, common.wallet, common.transactions, common.withdrawals, common.face, common.support],
  COIN_SELLER: [common.overview, common.wallet, common.commerce, common.transactions],
  // CS work is intentionally concentrated in one search-first workspace.
  // Master still sees every CS action through the platform audit trail.
  MONITORING_CS: [common.overview, common.monitoring, common.support],
};

const navigationGroups = [
  { label: "Core", items: [common.overview, common.hierarchy, common.accounts, common.users, common.hosts, common.agencies] },
  { label: "Money", items: [common.wallet, common.commerce, common.transactions, common.withdrawals] },
  { label: "Safety", items: [common.monitoring, common.rooms, common.face, common.risk, common.support, common.audit] },
  { label: "Platform", items: [common.reports, common.gifts, common.banners, common.notifications, common.settings] },
] satisfies { label: string; items: NavItem[] }[];

export function AppShell({ account, children }: { account: SessionAccount; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const visibleItems = navigationByRole[account.role];
  const visibleHrefs = new Set(visibleItems.map((item) => item.href));
  const visibleGroups = navigationGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => visibleHrefs.has(item.href)) }))
    .filter((group) => group.items.length);
  const quickSearchTarget = account.role === "COIN_SELLER"
    ? "/dashboard/wallet"
    : account.role === "MONITORING_CS"
      ? "/dashboard/monitoring"
      : "/dashboard/hosts";
  const mobileItems = visibleItems.slice(0, 4);
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
      <div className="sidebar-brand-row"><Link href="/dashboard" className="brand" aria-label="Nazraa Control home"><Image className="brand-logo" src="/nazraa-logo.jpg" width={34} height={34} alt="" priority /><span>Nazraa <em>Control</em></span></Link><button className="sidebar-close" type="button" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={20} /></button></div>
      <nav aria-label="Primary navigation">
        {visibleGroups.map((group) => <div className="nav-group" key={group.label}><p className="nav-caption">{group.label}</p>{group.items.map((item) => { const Icon = item.icon; const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href); return <Link href={item.href} key={item.href} className={`nav-link ${active ? "active" : ""}`} onClick={() => setMenuOpen(false)}><Icon size={18} /><span>{item.label}</span></Link>; })}</div>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="account-chip"><span className="avatar small">{initials(account.fullName)}</span><span><b>{account.fullName}</b><small>{roleLabel(account.role)}</small></span></div>
        <form action={signOut}><button className="signout" type="submit"><LogOut size={16} />Sign out</button></form>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <button className="mobile-menu" type="button" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
        <form className="quick-search" action={quickSearchTarget}><Search size={18} /><input ref={searchRef} name="q" aria-label="User or host search" placeholder={account.role === "COIN_SELLER" ? "Search user name or ID" : "Search user or host ID"} /><kbd>⌘ K</kbd></form>
        <div className="top-actions"><span className="role-context"><Gauge size={16} />{roleLabel(account.role)}</span></div>
      </header>
      <div className="page-content">{children}</div>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">{mobileItems.map((item) => { const Icon = item.icon; const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href); return <Link href={item.href} key={item.href} className={active ? "active" : ""}><Icon size={19} /><span>{item.label}</span></Link>; })}</nav>
    </main>
  </div>;
}

export function CoinsIcon() { return <Coins size={20} />; }

export function RupeeIcon() { return <BadgeIndianRupee size={20} />; }
