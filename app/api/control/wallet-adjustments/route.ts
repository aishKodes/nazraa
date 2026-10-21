import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { assertPortalOrigin } from "@/lib/auth/host-payout-session";
import { scopeFor } from "@/lib/db/repositories/accounts";
import { adjustUserBalance } from "@/lib/db/repositories/master-adjustments";
import { AdjustmentError, masterAdjustmentSchema } from "@/lib/finance/master-adjustment";

export async function POST(request: Request) {
  const account = await getSession();
  if (!account) return NextResponse.json({ error: 'Sign in required.' }, {status:401});
  if (account.role !== 'MASTER' || !can(account.role,'wallet.adjust')) return NextResponse.json({error:'Only Master can adjust user balances.'},{status:403});
  // Reuse the existing configured Control origins; the internal Next request
  // URL may be localhost behind Caddy, and forwarded Host is not authority.
  try { assertPortalOrigin(request); } catch { return NextResponse.json({error:'Request origin not permitted.'},{status:403}); }
  const parsed = masterAdjustmentSchema.safeParse(await request.json().catch(()=>null));
  if (!parsed.success) return NextResponse.json({error:'Check the amount, reason and confirmation.'},{status:400});
  try {
    const result = await adjustUserBalance(await scopeFor(account),parsed.data);
    return NextResponse.json({success:true,result},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    return NextResponse.json({error:error instanceof AdjustmentError?error.message:'The adjustment could not be confirmed. Retry the same request; it cannot apply twice.'},
      {status:error instanceof AdjustmentError?error.status:503,headers:{'Cache-Control':'no-store'}});
  }
}
