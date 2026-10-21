import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { scopeFor } from "@/lib/db/repositories/accounts";
import { transferHostAgency } from "@/lib/db/repositories/host-operations";
export async function POST(request:Request) {
  const account=await getSession();
  if(!account) return NextResponse.json({error:'Sign in required.'},{status:401});
  if(account.role!=='MASTER') return NextResponse.json({error:'Master only.'},{status:403});
  if(!['https://nazralive.in','https://api.nazraa.pixtra.site'].includes(request.headers.get('origin')??'')) return NextResponse.json({error:'Request origin not permitted.'},{status:403});
  const parsed=z.object({hostId:z.string().uuid(),destinationAgencyId:z.union([z.string().uuid(),z.string().regex(/^\d{6}$/),z.null()]),expectedAgencyId:z.string().uuid().nullable().optional(),reason:z.string().trim().min(5).max(500),confirmed:z.literal(true)}).strict().safeParse(await request.json().catch(()=>null));
  if(!parsed.success) return NextResponse.json({error:'Choose a valid Agency and confirm the action.'},{status:400});
  try {return NextResponse.json({success:true,result:await transferHostAgency({...parsed.data,scope:await scopeFor(account)})});}
  catch(error){return NextResponse.json({error:error instanceof Error&&!('code' in error)?error.message:'Agency update failed. Please retry.'},{status:400});}
}
