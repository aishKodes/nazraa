import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { scopeFor } from '@/lib/db/repositories/accounts';
import { searchAdjustmentTargets } from '@/lib/db/repositories/master-adjustments';
import { AdjustmentError } from '@/lib/finance/master-adjustment';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const headers = {'Cache-Control':'private, no-store', 'Vary':'Cookie'};
  const account = await getSession();
  if (!account) return NextResponse.json({error:'Sign in required.'},{status:401,headers});
  if (account.role !== 'MASTER' || !can(account.role,'wallet.adjust')) return NextResponse.json({error:'Only Master can search allocation wallets.'},{status:403,headers});
  const params = new URL(request.url).searchParams;
  const query = params.get('q') ?? '';
  const page = Number(params.get('page') ?? '1');
  if (query.length > 160 || !Number.isInteger(page) || page < 1 || page > 50)
    return NextResponse.json({error:'Refine the ID search.'},{status:400,headers});
  try {
    return NextResponse.json(await searchAdjustmentTargets(await scopeFor(account),query,page),{headers});
  } catch(error) {
    return NextResponse.json({error:error instanceof AdjustmentError ? error.message : 'Account search is temporarily unavailable. Please retry.'},
      {status:error instanceof AdjustmentError ? error.status : 503,headers});
  }
}
