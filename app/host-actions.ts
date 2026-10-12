"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guard";
import { transferHostAgency } from "@/lib/db/repositories/host-operations";
export async function submitHostAgencyTransfer(form:FormData) {
  const scope=await requirePermission('accounts.reassign');
  const parsed=z.object({hostId:z.string().uuid(),destinationAgencyId:z.union([z.string().uuid(),z.string().regex(/^\d{6}$/),z.literal('')]),
    reason:z.string().trim().min(5).max(500),confirmed:z.literal('yes')}).safeParse({hostId:form.get('hostId'),destinationAgencyId:form.get('destinationAgencyId')??'',reason:form.get('reason'),confirmed:form.get('confirmed')});
  if(!parsed.success) redirect('/dashboard/hosts?error=Choose%20a%20valid%20Host%20and%20Agency%20and%20confirm.');
  let message='';let failed=false;
  try {const result=await transferHostAgency({...parsed.data,scope,destinationAgencyId:parsed.data.destinationAgencyId||null,confirmed:true});
    message=result.agencyName?`Host transferred to ${result.agencyName} (${result.agencyId}).`:'Host removed from Agency; account and history preserved.';
  } catch(error){failed=true; message=error instanceof Error&&!('code' in error)?error.message:'The Agency update could not be saved. Please retry.';}
  for(const path of ['/dashboard/hosts','/dashboard/agencies','/dashboard/agency-report','/dashboard/live-rewards']) revalidatePath(path);
  redirect(`/dashboard/hosts/${parsed.data.hostId}?${failed?'error':'success'}=${encodeURIComponent(message)}`);
}
