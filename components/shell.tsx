import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { Activity, BadgeIndianRupee, Bell, Building2, ChevronDown, CircleHelp, ClipboardList, Coins, FileBarChart, Gauge, Landmark, LayoutDashboard, LogOut, Menu, Network, Radio, ReceiptText, Search, Settings, ShieldAlert, Users, WalletCards } from "lucide-react";
import { signOut } from "@/app/actions";
import { can, type Permission } from "@/lib/auth/permissions";
import { initials } from "@/lib/utils/format";
import type { SessionAccount } from "@/types/platform";

type NavItem = { href: Route; label: string; icon: typeof LayoutDashboard; permission: Permission };

const navigation: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, permission: "dashboard.read" },
  { href: "/dashboard/users", label: "Users", icon: Users, permission: "users.read" },
  { href: "/dashboard/hosts", label: "Hosts", icon: Activity, permission: "hosts.read" },
  { href: "/dashboard/agencies", label: "Agencies", icon: Building2, permission: "agencies.read" },
  { href: "/dashboard/hierarchy", label: "Hierarchy", icon: Network, permission: "hierarchy.read" },
  { href: "/dashboard/wallet", label: "Wallet & economy", icon: WalletCards, permission: "wallet.read" },
  { href: "/dashboard/transactions", label: "Transactions", icon: ReceiptText, permission: "transactions.read" },
  { href: "/dashboard/withdrawals", label: "Withdrawals", icon: Landmark, permission: "withdrawals.read" },
  { href: "/dashboard/rooms", label: "Live rooms", icon: Radio, permission: "rooms.read" },
  { href: "/dashboard/reports", label: "Reports", icon: FileBarChart, permission: "reports.export" },
  { href: "/dashboard/audit", label: "Audit log", icon: ClipboardList, permission: "audit.read" },
  { href: "/dashboard/risk", label: "Risk queue", icon: ShieldAlert, permission: "risk.read" },
  { href: "/dashboard/support", label: "Support", icon: CircleHelp, permission: "users.read" },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, permission: "settings.manage" },
];

function roleLabel(role: string) {
  return role.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function AppShell({ account, children }: { account: SessionAccount; children: ReactNode }) {
  const visibleItems = navigation.filter((item) => can(account.role, item.permission));
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/dashboard" className="brand" aria-label="Nazraa Control home"><span className="brand-mark">N</span><span>Nazraa <em>Control</em></span></Link>
      <nav aria-label="Primary navigation">
        <p className="nav-caption">Workspace</p>
        {visibleItems.map((item) => { const Icon = item.icon; return <Link href={item.href} key={item.href} className="nav-link"><Icon size={18} /><span>{item.label}</span></Link>; })}
      </nav>
      <div className="sidebar-bottom">
        <div className="account-chip"><span className="avatar small">{initials(account.fullName)}</span><span><b>{account.fullName}</b><small>{roleLabel(account.role)}</small></span></div>
        <form action={signOut}><button className="signout" type="submit"><LogOut size={16} />Sign out</button></form>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <button className="mobile-menu" aria-label="Open navigation"><Menu size={20} /></button>
        <div className="quick-search"><Search size={18} /><span>Search user, room or transaction</span><kbd>⌘ K</kbd></div>
        <div className="top-actions"><button className="icon-button" aria-label="Notifications"><Bell size={19} /><i /></button><span className="role-context"><Gauge size={16} />{roleLabel(account.role)}<ChevronDown size={15} /></span></div>
      </header>
      <div className="page-content">{children}</div>
    </main>
  </div>;
}

export function CoinsIcon() { return <Coins size={20} />; }

export function RupeeIcon() { return <BadgeIndianRupee size={20} />; }
