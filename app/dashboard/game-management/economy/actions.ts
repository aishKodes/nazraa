'use server';
import {revalidatePath} from 'next/cache';
import {requirePermission} from '@/lib/auth/guard';
import {configurableGameIds,type ConfigurableGameId} from '@/lib/games/game-config';
import {previewGameEconomy,publishGameEconomy,currentGameEconomy} from '@/lib/db/repositories/game-economy';
import {simulateEconomy,type EconomyDraft} from '@/lib/games/economy-policy';

export type EconomyActionState={error?:string;success?:string;preview?:Awaited<ReturnType<typeof previewGameEconomy>>;simulation?:Awaited<ReturnType<typeof simulateEconomy>>};
function parse(form:FormData){
  const game=String(form.get('game')) as ConfigurableGameId;
  if(!configurableGameIds.includes(game))throw new Error('Choose a supported game.');
  const draft:EconomyDraft={enabled:form.get('availability')!=='DISABLED',maintenance:form.get('availability')==='MAINTENANCE',minimumBet:Number(form.get('minimumBet')),maximumBet:Number(form.get('maximumBet')),maximumPayoutMultiplier:Number(form.get('maximumPayoutMultiplier')),payoutScalePpm:Number(form.get('payoutScalePpm'))};
  if(!['ACTIVE','MAINTENANCE','DISABLED'].includes(String(form.get('availability'))))throw new Error('Choose valid availability.');
  const weights=String(form.get('outcomeWeights')??'').trim();
  if(weights){if(weights.split(',').some(n=>!n.trim()))throw new Error('Choose valid outcome weights.');draft.outcomeWeights=weights.split(',').map(n=>Number(n.trim()));}
  for(const key of ['sideBetPayoutScalePpm','saladWeight','pizzaWeight','poolContributionBps','poolMinimumForSpecial'] as const)if(form.has(key))draft[key]=Number(form.get(key));
  return {game,draft};
}
function safeError(e:unknown){const message=e instanceof Error?e.message:'';return /^(Choose |Princess |Lion Vs Tiger |Maximum bet |Enter a change |Configuration changed|Only Master|Game settings|Multi-payline|Stateful|No verified)/.test(message)?message:'The game configuration could not be processed. Please retry.';}
export async function economyAction(_previous:EconomyActionState,form:FormData):Promise<EconomyActionState>{
  const scope=await requirePermission('settings.manage');
  try{
    const {game,draft}=parse(form),intent=String(form.get('intent')??'preview');
    if(intent==='publish'){
      if(form.get('confirmed')!=='yes')throw new Error('Choose confirmation after reviewing the preview.');
      const version=await publishGameEconomy(scope,game,draft,Number(form.get('expectedVersion')),String(form.get('reason')??''));
      revalidatePath('/dashboard/game-management/economy');revalidatePath('/dashboard/settings');
      return {success:`Published version ${version}. Effective for new rounds only.`};
    }
    if(intent==='simulate'){
      const {settings}=await currentGameEconomy(scope);
      return {simulation:await simulateEconomy(game,settings.games[game],Number(form.get('rounds')))};
    }
    return {preview:await previewGameEconomy(scope,game,draft)};
  }catch(e){return {error:safeError(e)};}
}
