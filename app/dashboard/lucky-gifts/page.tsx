import {requirePermission} from '@/lib/auth/guard';
import {luckyGiftControl,saveLuckyGiftControl} from '@/lib/db/repositories/lucky-gifts';
import {luckyDefaults,luckyPolicy} from '@/lib/policy/lucky-gifts';
import {revalidatePath} from 'next/cache';
async function save(form:FormData){'use server';const scope=await requirePermission('settings.manage');
 const count=Number(form.get('count'));if(!Number.isInteger(count)||count<1||count>50)throw Error('Invalid tier list');
 const tiers=Array.from({length:count},(_,i)=>({id:String(form.get('id'+i)),rewardType:'MULTIPLIER' as const,multiplierBps:Math.round(Number(form.get('multiplier'+i))*10000),weight:Number(form.get('weight'+i)),enabled:form.get('enabled'+i)==='on'}));
 await saveLuckyGiftControl(scope,luckyPolicy({...luckyDefaults,enabled:form.get('enabled')==='on',tiers}),String(form.get('reason')??''));revalidatePath('/dashboard/lucky-gifts');
}
export default async function Page(){const scope=await requirePermission('settings.manage');const {policy,expectation,daily}=await luckyGiftControl(scope);
 return <><h1>Lucky Gifts — internal Master controls</h1><p>Normal Gifts remain 85% recipient / 15% platform. Lucky Gifts allocate 20% Diamonds to recipient and 80% company allocation before the sender bonus. Allocation is not profit.</p>
 <p>Win chance: 25%. Expected Lucky return: {expectation.payoutPercent.toFixed(4)}%. Expected company remainder: {expectation.expectedCompanyPercent.toFixed(4)}% before other liabilities. Maximum exposure: 25× gross per attempt. Jackpot probability: {(expectation.jackpotProbability*100).toFixed(6)}%.</p>
 <form action={save}><input type="hidden" name="count" value={policy.tiers.length}/><label><input type="checkbox" name="enabled" defaultChecked={policy.enabled}/> Enable Lucky Gifts</label><table><thead><tr><th>Tier</th><th>Multiplier</th><th>Conditional win weight</th><th>Enabled</th></tr></thead><tbody>{policy.tiers.map((t,i)=><tr key={t.id}><td>{t.id}<input type="hidden" name={'id'+i} value={t.id}/></td><td><input name={'multiplier'+i} type="number" min="0.1" max="25" step="0.01" defaultValue={t.multiplierBps/10000} required/></td><td><input name={'weight'+i} type="number" min="0" max="100000000" defaultValue={t.weight} required/></td><td><input name={'enabled'+i} type="checkbox" defaultChecked={t.enabled}/></td></tr>)}</tbody></table><label>Reason<input name="reason" minLength={5} maxLength={500} required/></label><button>Save prospective policy</button></form>
 <h2>Durable Lucky accounting</h2><table><thead><tr><th>UTC date</th><th>Attempts</th><th>Gross</th><th>Recipient Diamonds</th><th>Company allocation</th><th>Lucky payout</th><th>Company remainder</th></tr></thead><tbody>{daily.map(r=><tr key={r.day}><td>{r.day}</td><td>{r.attempts}</td><td>{r.gross}</td><td>{r.receiverDiamonds}</td><td>{r.companyAllocation}</td><td>{r.luckyPayout}</td><td>{r.netCompanyCoins}</td></tr>)}</tbody></table></>;
}
