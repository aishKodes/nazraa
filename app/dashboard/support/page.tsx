import { MessageSquareText } from "lucide-react";
import { Card, SectionHeading } from "@/components/ui";
import { requirePermission } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  await requirePermission("users.read");
  return <><SectionHeading title="Support" description="The support workspace is kept intentionally separate from financial and moderation decisions." />
    <Card className="empty-state"><MessageSquareText size={28} /><strong>No ticket source connected yet</strong><span>Connect the mobile app&apos;s support-ticket endpoint before enabling this workspace. Until then, support staff cannot create hidden notes or alter account balances here.</span></Card>
  </>;
}
