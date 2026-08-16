import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Card, SectionHeading } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePermission("settings.manage");
  return <><SectionHeading title="Platform settings" description="Sensitive settings remain server-owned. Secrets and money rules never reach browser bundles." />
    <div className="report-grid"><Card><ShieldCheck className="report-icon" size={24} /><h2>Country documents</h2><p>India, Bangladesh, and Nepal document definitions are seeded in the database. Full government IDs and private files are intentionally not displayed here.</p></Card><Card><LockKeyhole className="report-icon" size={24} /><h2>Security baseline</h2><p>Session cookies are HTTP-only. Database configuration is read exclusively on the server. Bootstrap creates the first Master with a hashed password.</p></Card></div>
  </>;
}
