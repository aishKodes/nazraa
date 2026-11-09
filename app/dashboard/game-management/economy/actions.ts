'use server';
import {redirect} from 'next/navigation';
import {setCatalogOperator} from '@/lib/auth/catalog-operators';
import {revalidatePath} from 'next/cache';
import {requirePermission} from '@/lib/auth/guard';
import {configurableGameIds,gameEconomyModes,type ConfigurableGameId,type GameEconomyMode} from '@/lib/games/game-config';
import {previewGameEconomy,publishGameEconomy,currentGameEconomy} from '@/lib/db/repositories/game-economy';
import {economyModel,simulateEconomy,type EconomyDraft} from '@/lib/games/economy-policy';

export type EconomyActionState={error?:string;success?:string;preview?:Awaited<ReturnType<typeof previewGameEconomy>>;simulation?:Awaited<ReturnType<typeof simulateEconomy>>};
function parse(form:FormData){
  const game=String(form.get('game')) as ConfigurableGameId;
  if(!configurableGameIds.includes(game))throw new Error('Choose a supported game.');
  const draft:EconomyDraft={enabled:form.get('availability')!=='DISABLED',maintenance:form.get('availability')==='MAINTENANCE',minimumBet:Number(form.get('minimumBet')),maximumBet:Number(form.get('maximumBet')),maximumPayoutMultiplier:Number(form.get('maximumPayoutMultiplier')),payoutScalePpm:Number(form.get('payoutScalePpm'))};
  if(!['ACTIVE','MAINTENANCE','DISABLED'].includes(String(form.get('availability'))))throw new Error('Choose valid availability.');
  if(form.has('princessPayoutProfile'))draft.princessPayoutProfile=String(form.get('princessPayoutProfile')) as EconomyDraft['princessPayoutProfile'];
  if(form.get('controlMode')==='TARGET_RTP'){
    if(form.has('mode')){
      const mode=String(form.get('mode')) as GameEconomyMode;
      if(!gameEconomyModes.includes(mode))throw Error('Choose a valid game economy mode.');
      draft.mode=mode;
    }draft.controlMode='TARGET_RTP';draft.targetRtp=Math.round(Number(form.get('targetRtpPercent'))*1000000)/100000000;draft.denominations=String(form.get('denominations')??'').split(',').map(n=>{
      const chip=n.trim();
      if(!/^\d+$/.test(chip))throw Error('Choose whole-number betting Coins, separated by commas.');
      return Number(chip);
    });}
  if(game==='teen_patti'){
    if(form.has('targetRtpPercent'))draft.targetRtp=Math.round(Number(form.get('targetRtpPercent'))*1000000)/100000000;
    if(form.has('greenWeight'))draft.outcomeWeights=['greenWeight','blueWeight','redWeight'].map(key=>Number(form.get(key)));
    for(const key of ['maximumSingleRoundPayout','maximumRoundExposure','bigWinThreshold','bettingSeconds','resultSeconds'] as const)if(form.has(key))draft[key]=Number(form.get(key));
  }
  const weights=String(form.get('outcomeWeights')??'').trim();
  if(weights){if(weights.split(',').some(n=>!n.trim()))throw new Error('Choose valid outcome weights.');draft.outcomeWeights=weights.split(',').map(n=>Number(n.trim()));}
  for(const key of ['princessServiceFeeBps','sideBetPayoutScalePpm','saladWeight','pizzaWeight','poolContributionBps','poolMinimumForSpecial'] as const)if(form.has(key))draft[key]=Number(form.get(key));
  return {game,draft};
}
function safeError(e:unknown){const message=e instanceof Error?e.message:'';return /^(Choose |Princess |Lion Vs Tiger |Maximum bet |Enter a change |Configuration changed|Only Master|Game settings|Multi-payline|Stateful|No verified|TARGET NOT ACHIEVABLE)/.test(message)?message:'The game configuration could not be processed. Please retry.';}
export async function economyAction(_previous:EconomyActionState,form:FormData):Promise<EconomyActionState>{
  const scope=await requirePermission('games.read');
  try{
    const {game,draft}=parse(form),intent=String(form.get('intent')??'preview');
    if(scope.account.role!=='MASTER'&&!draft.mode)throw Error('Choose a game economy mode before applying.');
    if(intent==='publish'){
      if(form.get('confirmed')!=='yes')throw new Error('Choose confirmation after reviewing the preview.');
      const version=await publishGameEconomy(scope,game,draft,Number(form.get('expectedVersion')),String(form.get('reason')??''));
      revalidatePath('/dashboard/game-management/economy');revalidatePath('/dashboard/game-management');revalidatePath('/dashboard/settings');
      const {settings}=await currentGameEconomy(scope);const active=settings.games[game];
      return {success:`Active config v${version} · target ${(active.targetRtp*100).toFixed(4)}% · theoretical ${economyModel(game,active).average==null?'unavailable':(economyModel(game,active).average!*100).toFixed(4)+'%'} · effective for future rounds only. Existing rounds retain their snapshot.`};
    }
    if(intent==='simulate'||intent==='simulate-preview'){
      const {settings}=await currentGameEconomy(scope);
      const proposed=intent==='simulate-preview'?await previewGameEconomy(scope,game,draft):undefined;
      return {..._previous,...(proposed?{preview:proposed}:{}),simulation:await simulateEconomy(game,proposed?.proposed??settings.games[game],Number(form.get('rounds')))};
    }
    return {preview:await previewGameEconomy(scope,game,draft)};
  }catch(e){return {error:safeError(e)};}
}

export async function setEconomyOperatorAction(form: FormData) {
  const scope = await requirePermission("settings.manage");
  try {
    await setCatalogOperator(scope, String(form.get("publicId") ?? ""), {
      games: form.has("games"), gifts: form.has("gifts"),
    }, String(form.get("reason") ?? ""));
  } catch {
    redirect("/dashboard/game-management/economy?operatorError=1");
  }
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/game-management/economy?operatorSaved=1");
}
