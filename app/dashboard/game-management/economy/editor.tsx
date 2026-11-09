'use client';
import {useActionState,useMemo,useState} from 'react';
import {economyAction,type EconomyActionState} from './actions';
import {gameEconomyModes,type ConfigurableGameId,type GameRuntimeConfig,type GameEconomyMode} from '@/lib/games/game-config';
import {gameNames} from '@/lib/games/game-names';
import {targetRtpPolicy} from '@/lib/games/target-rtp';
import {economyModeLabels,economyModePreview,savedEconomyPreset} from '@/lib/games/economy-presets';
import {economyModel} from '@/lib/games/economy-model';

export function EconomyEditor({game,config}:{game:ConfigurableGameId;config:GameRuntimeConfig}){
 const [state,action,pending]=useActionState<EconomyActionState,FormData>(economyAction,{});
 return <EconomyFields key={`${game}:${config.economyVersion??0}`} game={game} config={config} state={state} action={action} pending={pending}/>;
}
function EconomyFields({game,config,state,action,pending}:{game:ConfigurableGameId;config:GameRuntimeConfig;state:EconomyActionState;action:(form:FormData)=>void;pending:boolean}){
 const [mode,setMode]=useState<GameEconomyMode>(config.economyMode??'NORMAL');
 const [target,setTarget]=useState(String(Number((config.targetRtp*100).toFixed(8))));
 const [chips,setChips]=useState(config.denominations.join(', '));
 const [minimum,setMinimum]=useState(config.minimumBet),[maximum,setMaximum]=useState(config.maximumBet);
 const [single,setSingle]=useState(config.maximumSingleRoundPayout??150000000),[exposure,setExposure]=useState(config.maximumRoundExposure??1250000000),[bigWin,setBigWin]=useState(config.bigWinThreshold);
 const [ceiling,setCeiling]=useState(config.maximumPayoutMultiplier);
 const [availability,setAvailability]=useState(!config.enabled?'DISABLED':config.maintenance?'MAINTENANCE':'ACTIVE');
 const policy=targetRtpPolicy(game,config,mode);
 const changeMode=(next:GameEconomyMode)=>{
   const saved=savedEconomyPreset(config,next);
   setMode(next);
   setTarget(String(saved ? Number((saved.targetRtp*100).toFixed(8)) : next==='HIGH_PAYOUT'?105:Number((config.targetRtp*100).toFixed(8))));
   setCeiling(saved?.maximumPayoutMultiplier??config.maximumPayoutMultiplier);
   setMaximum(saved?.maximumBet??config.maximumBet);
 };
 const calculated=useMemo(()=>{
   try {
     const parsedTarget=policy.editable?Math.round(Number(target)*1_000_000)/100_000_000:config.targetRtp;
     const c=economyModePreview(game,config,mode,parsedTarget,maximum,ceiling);
     return {config:c,model:economyModel(game,c),error:''};
   } catch(e) {
     return {config:null,model:null,error:e instanceof Error?e.message:'The target cannot be calculated.'};
   }
 },[game,config,mode,target,ceiling,maximum,policy.editable]);
 const fields=()=><>{Object.entries({game,mode,controlMode:'TARGET_RTP',availability,
   targetRtpPercent:policy.editable?target:config.targetRtp*100,minimumBet:minimum,maximumBet:maximum,
   maximumPayoutMultiplier:ceiling,payoutScalePpm:config.payoutScalePpm,denominations:chips,
   ...(game==='teen_patti'?{maximumSingleRoundPayout:single,maximumRoundExposure:exposure,bigWinThreshold:bigWin}:{})
 }).map(([name,value])=><input key={name} name={name} type="hidden" value={String(value)}/>)}</>;
 const preview=state.preview?.game===game ? state.preview : undefined;
 const stale=preview&&(!!calculated.error||preview.proposed.economyMode!==mode||
   Math.abs(preview.proposed.targetRtp-(calculated.config?.targetRtp??0))>=1e-9||preview.proposed.payoutScalePpm!==calculated.config?.payoutScalePpm||
   preview.proposed.maximumPayoutMultiplier!==calculated.config?.maximumPayoutMultiplier||
   preview.proposed.minimumBet!==minimum||preview.proposed.maximumBet!==calculated.config?.maximumBet||
   preview.proposed.enabled!==(availability!=='DISABLED')||preview.proposed.maintenance!==(availability==='MAINTENANCE')||
   (game==='teen_patti'&&(preview.proposed.maximumSingleRoundPayout!==single||preview.proposed.maximumRoundExposure!==exposure||preview.proposed.bigWinThreshold!==bigWin))||
   JSON.stringify(preview.proposed.denominations)!==JSON.stringify(chips.split(',').map(s=>Number(s.trim()))));
 return <section aria-label={`${gameNames[game]} controls`}><h3>Game Control · active v{config.economyVersion??0}</h3><p>{policy.scope}. {policy.note}</p><p>These are proposed settings until Save / Apply. The maximum bet is automatically bounded by the existing settlement ceiling.</p>
 <form action={action} className="form-grid">{fields()}
 <label>Economy mode<select aria-label="Economy mode" value={mode} disabled={!policy.editable} onChange={e=>changeMode(e.target.value as GameEconomyMode)}>{gameEconomyModes.map(value=><option key={value} value={value}>{economyModeLabels[value]}</option>)}</select></label>
 <label>Target RTP (%)<input aria-label="Target RTP" type="number" step="0.01" value={target} readOnly={!policy.editable} onChange={e=>setTarget(e.target.value)}/><small>{policy.editable?`Server policy: ${(policy.minimum*100).toFixed(2)}%–${(policy.maximum*100).toFixed(2)}%. Changes require preview and publication.`:'Locked: this game has no approved adjustable scalar RTP model.'}</small></label>
 <label>Status<select aria-label="Game status" value={availability} onChange={e=>setAvailability(e.target.value)}><option>ACTIVE</option><option>MAINTENANCE</option><option>DISABLED</option></select></label>
 <label>Betting Coins<input aria-label="Betting Coins" value={chips} onChange={e=>setChips(e.target.value)}/><small>Enter enabled chips in display order. Add, remove or reorder whole Coin values, separated by commas.</small></label>
 <label>Minimum bet (Coins)<input type="number" aria-label="Minimum bet" min="1" value={minimum} readOnly={game==='teen_patti'||game==='lion_vs_tiger'} onChange={e=>setMinimum(Number(e.target.value))}/></label>
 <label>Maximum bet per round (Coins)<input type="number" aria-label="Maximum bet" min="1" value={maximum} readOnly={game==='lion_vs_tiger'} onChange={e=>setMaximum(Number(e.target.value))}/></label>
 {game==='teen_patti'&&<><label>Maximum single-round net payout (Coins)<input aria-label="Maximum single-round payout" type="number" min="100" max="1250000000" value={single} onChange={e=>setSingle(Number(e.target.value))}/></label><label>Maximum table exposure (Coins)<input aria-label="Maximum table exposure" type="number" min="100" max="1250000000" value={exposure} onChange={e=>setExposure(Number(e.target.value))}/></label><label>Big Win display threshold (Coins)<input aria-label="Big Win threshold" type="number" min="1" max="1000000000" value={bigWin} onChange={e=>setBigWin(Number(e.target.value))}/></label></>}
 {game!=='teen_patti'&&<label>Maximum gross payout (× round wager)<input type="number" aria-label="Maximum payout multiplier" step="0.01" min="1" max="1000" readOnly={!policy.editable} value={ceiling} onChange={e=>setCeiling(Number(e.target.value))}/></label>}
 <div role="status" aria-live="polite"><b>Calculated theoretical RTP: {calculated.model?.average==null?'Unavailable':(calculated.model.average*100).toFixed(5)+'%'}</b><p>Modeled house edge: {calculated.model?.average==null?'Unavailable':((1-calculated.model.average)*100).toFixed(5)+'%'}</p>{calculated.model?.average!=null&&calculated.model.average>1&&<p><strong>Expected promotional loss:</strong> modeled payouts exceed wagers over time.</p>}{calculated.error&&<p role="alert">{calculated.error}</p>}</div>
 <button name="intent" value="preview" className="primary-button" disabled={pending||!!calculated.error}>{pending?'Processing…':'Preview changes'}</button></form>
 <details><summary>Calculated internals / existing limits</summary><p>Probabilities are preserved. No setting reads current wagers to choose outcomes.</p><p>Paytable scale: {calculated.config?.payoutScalePpm??config.payoutScalePpm} ppm · gross return ceiling {calculated.config?.maximumPayoutMultiplier??config.maximumPayoutMultiplier}× · Crown scale {config.sideBetPayoutScalePpm??'not applicable'}.</p>{calculated.model?.areas.map(a=><p key={a.label}>{a.label}: {(a.probability*100).toFixed(4)}% probability · {a.netReturn.toFixed(5)}× net · {(a.rtp*100).toFixed(5)}% single-area RTP.</p>)}{game==='teen_patti'&&<p>Maximum single-player net payout: {config.maximumSingleRoundPayout?.toLocaleString()} Coins. Table exposure: {config.maximumRoundExposure?.toLocaleString()} Coins. Big Win label: {config.bigWinThreshold.toLocaleString()} Coins. Betting {config.bettingSeconds}s / result {config.resultSeconds}s.</p>}</details>
 {state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}
 {preview&&<div><h3>Current → proposed</h3><p>Active v{preview.expectedVersion} · Target {(preview.current.targetRtp*100).toFixed(4)}% → {(preview.proposed.targetRtp*100).toFixed(4)}%. Calculated theoretical {preview.model.average==null?'unavailable':(preview.model.average*100).toFixed(5)+'%'}.</p><p>{preview.effective}</p><p>Betting Coins: {preview.current.denominations.join(', ')} → {preview.proposed.denominations.join(', ')}. Minimum {preview.proposed.minimumBet.toLocaleString()}, maximum {preview.current.maximumBet.toLocaleString()} → {preview.proposed.maximumBet.toLocaleString()}.</p><p>Calculated return scale {preview.proposed.payoutScalePpm} ppm · ceiling {preview.proposed.maximumPayoutMultiplier}×.</p>{stale?<p role="alert">Inputs changed after preview. Preview again before applying.</p>:<form action={action} className="form-grid">{fields()}<input type="hidden" name="expectedVersion" value={preview.expectedVersion}/><label>Reason<input name="reason" required minLength={5} maxLength={500}/></label><label className="checkbox-line"><input type="checkbox" name="confirmed" value="yes" required/>Apply to future rounds only; existing rounds keep their accepted rules.</label><button name="intent" value="publish" disabled={pending} className="primary-button">{pending?'Publishing…':'Save / Apply'}</button></form>}</div>}
 </section>;
}
