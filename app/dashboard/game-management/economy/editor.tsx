'use client';
import {useActionState} from 'react';
import {economyAction,type EconomyActionState} from './actions';
import type {ConfigurableGameId,GameRuntimeConfig} from '@/lib/games/game-config';
import {gameNames} from '@/lib/games/game-names';

export function EconomyEditor({game,config}:{game:ConfigurableGameId;config:GameRuntimeConfig}){
  const [state,action,pending]=useActionState<EconomyActionState,FormData>(economyAction,{});
  const fixed=game==='teen_patti'||game==='lion_vs_tiger';
  const inputs=(c:GameRuntimeConfig)=><>
    <input name="game" type="hidden" value={game}/>
    <label>Availability<select name="availability" defaultValue={!c.enabled?'DISABLED':c.maintenance?'MAINTENANCE':'ACTIVE'}><option>ACTIVE</option><option>MAINTENANCE</option><option>DISABLED</option></select></label>
    <label>Minimum bet (Coins)<input name="minimumBet" type="number" min="1" required readOnly={fixed} defaultValue={c.minimumBet}/></label>
    <label>Maximum per request (Coins)<input name="maximumBet" type="number" min="1" required readOnly={game==='lion_vs_tiger'} defaultValue={c.maximumBet}/></label>
    <label>Maximum return × total wager<input name="maximumPayoutMultiplier" type="number" min="1" max="1000" step="0.01" readOnly={fixed} required defaultValue={c.maximumPayoutMultiplier}/></label>
    <label>Paytable scale (parts per million)<input name="payoutScalePpm" type="number" min="1" max="5000000" required readOnly={fixed} defaultValue={c.payoutScalePpm}/><small>1,000,000 = unchanged. This scales existing returns; it never selects a winner.</small></label>
    {game==='teen_patti_pro'&&<label>Crown paytable scale (parts per million)<input name="sideBetPayoutScalePpm" type="number" min="1" max="5000000" required defaultValue={c.sideBetPayoutScalePpm??1000000}/><small>The normal-lane RTP model excludes Crown.</small></label>}
    {game==='greedy_king'&&<>{(['saladWeight','pizzaWeight','poolContributionBps','poolMinimumForSpecial'] as const).map(key=><label key={key}>{({saladWeight:'Salad special weight',pizzaWeight:'Pizza special weight',poolContributionBps:'Pool contribution (basis points)',poolMinimumForSpecial:'Pool minimum for special (Coins)'})[key]}<input name={key} type="number" min="0" max={key==='poolContributionBps'?10000:key==='poolMinimumForSpecial'?1000000000:1000000} required defaultValue={c[key]??0}/></label>)}<p>Existing stateful special outcomes only. If enabled, a static theoretical RTP/simulation is unavailable. Pool contribution does not itself change the wallet debit.</p></>}
    {(game==='luck77'||game==='bounty_football')&&<label>Existing outcome weights<input name="outcomeWeights" required defaultValue={c.outcomeWeights?.join(', ')}/><small>{game==='luck77'?'77, Watermelon, Plum':'Ten teams in their existing displayed order'}. Global, bet-independent; new rounds only.</small></label>}
  </>;
  return <details><summary>Edit {gameNames[game]} configuration · v{config.economyVersion??0}</summary>
    <form action={action} className="form-grid">{inputs(config)}<button name="intent" value="preview" className="primary-button" disabled={pending}>{pending?'Processing…':'Preview configuration'}</button></form>
    {state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}
    {state.preview&&<div><h3>Review before publication</h3><p>{state.preview.effective}</p><div className="table-scroll"><table><thead><tr><th>Setting</th><th>Current</th><th>Proposed</th></tr></thead><tbody>{(['enabled','maintenance','minimumBet','maximumBet','maximumPayoutMultiplier','payoutScalePpm','outcomeWeights',...(game==='teen_patti_pro'?['sideBetPayoutScalePpm'] as const:[]),...(game==='greedy_king'?['saladWeight','pizzaWeight','poolContributionBps','poolMinimumForSpecial'] as const:[])] as const).map(key=><tr key={key}><td>{key}</td><td>{String(state.preview!.current[key]??'—')}</td><td>{String(state.preview!.proposed[key]??'—')}</td></tr>)}</tbody></table></div>
      <p>Modeled equal-area RTP: {state.preview.model.average==null?'Not computable with this model':(state.preview.model.average*100).toFixed(3)+'%'}. {state.preview.model.note}</p>
      <form action={action} className="form-grid" key={JSON.stringify(state.preview.proposed)}><div hidden>{inputs(state.preview.proposed)}</div><input type="hidden" name="expectedVersion" value={state.preview.expectedVersion}/><label>Audit reason<input name="reason" required minLength={5} maxLength={500}/></label><label><input type="checkbox" name="confirmed" value="yes" required/>I reviewed the current and proposed configuration and its future-round effect.</label><button name="intent" value="publish" disabled={pending} className="danger-button">Confirm and publish</button></form></div>}
    <form action={action} className="form-grid"><div hidden>{inputs(config)}</div><label>Internal simulation<select name="rounds"><option value="100000">100,000 rounds</option><option value="1000000">1,000,000 rounds</option></select></label><button name="intent" value="simulate" className="secondary-button" disabled={pending}>Simulate current configuration · no wallets</button></form>
    {state.simulation&&<div role="status"><p>{state.simulation.rounds.toLocaleString()} samples · theoretical {(state.simulation.theoreticalRtp*100).toFixed(3)}% · simulated {(state.simulation.simulatedRtp*100).toFixed(3)}% · variance {state.simulation.variance.toFixed(4)} · largest {state.simulation.largestPayoutPerUnit.toFixed(4)}×</p><p>{state.simulation.note}</p>{state.simulation.distribution.map(d=><span className="scope-lock" key={d.area}>{d.area}: {d.winningSamples.toLocaleString()} wins </span>)}</div>}
  </details>;
}
