import {redirect} from 'next/navigation';
import {requirePermission} from '@/lib/auth/guard';
import {gameEconomyDashboard} from '@/lib/db/repositories/game-economy';
import {gameNames} from '@/lib/games/economy-policy';
import {Card,Notice,SectionHeading} from '@/components/ui';
import {catalogOperatorAccess} from '@/lib/auth/catalog-operators';
import {setEconomyOperatorAction} from './actions';
import {EconomyEditor} from './editor';
import {formatNumber} from '@/lib/utils/format';
import {formatIst} from '@/lib/db/repositories/owner-reports';
import {configurableGameIds} from '@/lib/games/game-config';

export const dynamic='force-dynamic';
export default async function Economy({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const scope=await requirePermission('games.read');
  if(!(await catalogOperatorAccess(scope.account)).games)redirect('/dashboard?error=forbidden');
  const p=await searchParams;
  let data:Awaited<ReturnType<typeof gameEconomyDashboard>>;
  try{data=await gameEconomyDashboard(scope,p.period??'today',p.from,p.to);}catch{return <Notice type="error">Game economy data is unavailable. Check the date range or retry.</Notice>;}
  return <><SectionHeading title="Game Economy / RTP" description="Global controls for Master and authorized Admin operators. Durable settled stakes and net Coin returns; no refunds or cancelled/unresolved bets. No per-user outcome controls."/>
    {scope.account.role==='MASTER'&&<Card><details><summary>Delegate Admin catalog controls</summary>
      <p>Only a standalone Admin can use these global catalog grants. Global Manager branches retain scoped reporting.</p>
      <form action={setEconomyOperatorAction} className="form-grid">
        <label>Admin management ID<input name="publicId" inputMode="numeric" pattern="[0-9]{6}" required/></label>
        <label className="checkbox-line"><input type="checkbox" name="games"/>Manage game economy</label>
        <label className="checkbox-line"><input type="checkbox" name="gifts"/>Edit virtual gifts</label>
        <label>Audit reason<input name="reason" minLength={5} maxLength={500} required/></label>
        <button className="secondary-button">Save Admin access</button>
      </form></details></Card>}
    {p.operatorSaved==='1'&&<Notice type="success">Admin catalog permissions saved.</Notice>}
    {p.operatorError==='1'&&<Notice type="error">Unable to save permissions. Check the active Admin ID and audit reason.</Notice>}
    <Card><form className="form-grid"><label>Game<select name="game" defaultValue={p.game??''}><option value="">All games</option>{configurableGameIds.map(id=><option key={id} value={id}>{gameNames[id]}</option>)}</select></label><label>Date range<select name="period" defaultValue={p.period??'today'}><option value="today">Today (IST)</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="custom">Custom (IST)</option></select></label><label>From<input type="date" name="from" defaultValue={p.from}/></label><label>Through<input type="date" name="to" defaultValue={p.to}/></label><button className="primary-button">View economics</button></form><p>All games share the current global configuration. No country-specific or player-specific economics.</p></Card>
    {data.games.filter(g=>!p.game||g.game===p.game).map(g=><Card key={g.game}><h2>{gameNames[g.game]} <small>· {!g.config.enabled?'Disabled':g.config.maintenance?'Maintenance':'Active'} · v{g.config.economyVersion??0}</small></h2>
      <EconomyEditor game={g.game} config={g.config}/>
      <div className="table-scroll"><table><thead><tr><th style={{position:'static'}}>Staked</th><th style={{position:'static'}}>Net paid out</th><th style={{position:'static'}}>Platform net</th><th style={{position:'static'}}>Observed RTP</th><th style={{position:'static'}}>Sample</th><th style={{position:'static'}}>Average / largest round wager</th><th style={{position:'static'}}>Largest payout</th></tr></thead><tbody><tr><td>{formatNumber(g.staked)}</td><td>{formatNumber(g.paid)}</td><td>{formatNumber(g.net)}</td><td>{g.observed==null?'No settled stakes':(g.observed*100).toFixed(3)+'%'}</td><td>{g.rounds.toLocaleString()} rounds · {g.playerRounds.toLocaleString()} player-rounds · {g.players.toLocaleString()} players</td><td>{formatNumber(g.averageBet)} / {formatNumber(g.largestBet)}</td><td>{formatNumber(g.largestPayout)}</td></tr></tbody></table></div>
      <p>Configured future-round target: {(g.config.targetRtp*100).toFixed(3)}%. THEORETICAL RTP: {g.model.average==null?'Not available':(g.model.average*100).toFixed(3)+'%'}{g.model.average!=null?` · modeled house edge ${((1-g.model.average)*100).toFixed(3)}%`:''}.</p><p>{g.model.note}</p>
      <>
        <h3>Settled returns</h3><p>Historical windows include their accepted configuration versions; they are not repriced to the current target.</p>
        <div className="table-scroll"><table><thead><tr><th>Window</th><th>Total wager</th><th>Total paid</th><th>House result</th><th>Observed RTP</th><th>Round count</th></tr></thead><tbody>{g.windows.map(w=><tr key={w.label}><td>{w.label}</td><td>{formatNumber(w.staked)}</td><td>{formatNumber(w.paid)}</td><td>{formatNumber(w.net)}</td><td>{w.observed==null?'No settled wagers':(w.observed*100).toFixed(3)+'%'}</td><td>{formatNumber(w.rounds)}</td></tr>)}</tbody></table></div>
      </>
      {g.game==='teen_patti'&&<>
        <h3>Current configuration v{data.princessCurrent.version} · last 30 days</h3><p>{formatNumber(data.princessCurrent.rounds)} settled rounds · target {(g.config.targetRtp*100).toFixed(3)}% · observed {data.princessCurrent.observed==null?'No settled wagers':(data.princessCurrent.observed*100).toFixed(3)+'%'} · wager {formatNumber(data.princessCurrent.staked)} · paid {formatNumber(data.princessCurrent.paid)} · house result {formatNumber(data.princessCurrent.net)} Coins.</p>
        <p>Prospective single-player payout limit: {g.config.maximumSingleRoundPayout==null?'Legacy multiplier ceiling only':formatNumber(g.config.maximumSingleRoundPayout)+' Coins'}. Table exposure limit: {g.config.maximumRoundExposure==null?'Not configured on this legacy profile':formatNumber(g.config.maximumRoundExposure)+' Coins'}. Big Win display threshold: {formatNumber(g.config.bigWinThreshold)} Coins. Limits are admission controls, never outcome controls.</p>
      </>}
      {g.model.areas.length>0&&<div className="table-scroll"><table><thead><tr><th style={{position:'static'}}>Bet area</th><th style={{position:'static'}}>Probability</th><th style={{position:'static'}}>Net win return × stake</th><th style={{position:'static'}}>Single-area theoretical RTP</th></tr></thead><tbody>{g.model.areas.map(a=><tr key={a.label}><td>{a.label}</td><td>{(a.probability*100).toFixed(4)}%</td><td>{a.netReturn.toFixed(4)}</td><td>{(a.rtp*100).toFixed(3)}%</td></tr>)}</tbody></table></div>}
      {g.alert&&<Notice type="info">{g.alert}</Notice>}
      <p>Bet volume: {g.playerRounds.toLocaleString()} settled player-rounds. {g.recentPlayers} distinct settled players in the last 5 minutes within this range; this is activity, not a claim of current online presence.</p>
      </Card>)}
    <Card><h2>Immutable configuration history · latest 50</h2>{data.history.length?data.history.map(h=><details key={`${h.game_name}:${h.version}`}><summary>{String(h.game_name)} · v{String(h.version)} · {formatIst(h.effective_at)} · Operator {String(h.actor_id)}</summary><p>{String(h.reason)}</p><div className="form-grid"><div><h3>Previous</h3><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(typeof h.previous_config==='string'?JSON.parse(h.previous_config):h.previous_config,null,2)}</pre></div><div><h3>Published</h3><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(typeof h.config_json==='string'?JSON.parse(h.config_json):h.config_json,null,2)}</pre></div></div></details>):<p>No versioned changes published yet. Version 0 identifies the preserved deployment baseline.</p>}</Card>
  </>;
}
