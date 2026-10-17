"use server";
import {z} from 'zod';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requirePermission} from '@/lib/auth/guard';
import {savePrincessPricing} from '@/lib/db/repositories/catalog';

export async function publishPrincessPricing(formData:FormData){
 const scope=await requirePermission('settings.manage');
 if(scope.account.role!=='MASTER')throw new Error('Forbidden.');
 let failed=false;
 try{
  const input=z.object({mode:z.enum(['HIDDEN_FIXED_V2','PUBLIC_QUOTE_V3']),
    targetRtp:z.coerce.number().finite().min(.5).max(1),
    maximumMultiplier:z.coerce.number().finite().min(1).max(30),
    reason:z.string().trim().min(5).max(500)}).parse(Object.fromEntries(formData));
  await savePrincessPricing({scope,...input});
 }catch{failed=true;}
 revalidatePath('/dashboard/settings');
 redirect(`/dashboard/settings?${failed?'error':'success'}=${encodeURIComponent(failed?'Check Princess pricing values and reason.':'Princess pricing saved for new rounds. Existing cards and payouts remain immutable.')}`);
}
