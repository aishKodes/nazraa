import {redirect} from 'next/navigation';
import {requirePermission} from '@/lib/auth/guard';
import {gameEconomyDashboard} from '@/lib/db/repositories/game-economy';
import {gameNames} from '@/lib/games/economy-policy';
import {Card,Notice,SectionHeading} from '@/components/ui';
import {EconomyEditor} from './editor';
import {formatNumber} from '@/lib/utils/format';
import {formatIst} from '@/lib/db/repositories/owner-reports';
import {configurableGameIds} from '@/lib/games/game-config';

export const dynamic='force-dynamic';
export default async function Economy({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const scope=await requirePermission('games.read');
  if(scope.account.role!=='MASTER')redirect('/dashboard?error=forbidden');
  const p=await searchParams;
  let data:Awaited<ReturnType<typeof gameEconomyDashboard>>;
  try{data=await gameEconomyDashboard(scope,p.period??'today',p.from,p.to);}catch{return <Notice type="error">Game economy data is unavailable. Check the date range or retry.</Notice>;}
  return <><SectionHeading title="Game Economy / RTP" description="Master-only global controls. Durable settled stakes and net Coin returns; no refunds or cancelled/unresolved bets. No per-user outcome controls."/>
    <Card><form className="form-grid"><label>Game<select name="game" defaultValue={p.game??''}><option value="">All games</option>{configurableGameIds.map(id=><option key={id} value={id}>{gameNames[id]}</option>)}</select></label><label>Date range<select name="period" defaultValue={p.period??'today'}><option value="today">Today (IST)</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="custom">Custom (IST)</option></select></label><label>From<input type="date" name="from" defaultValue={p.from}/></label><label>Through<input type="date" name="to" defaultValue={p.to}/></label><button className="primary-button">View economics</button></form><p>All games share the current global configuration. No country-specific or player-specific economics.</p></Card>
    {data.games.filter(g=>!p.game||g.game===p.game).map(g=><Card key={g.game}><h2>{gameNames[g.game]} <small>· {!g.config.enabled?'Disabled':g.config.maintenance?'Maintenance':'Active'} · v{g.config.economyVersion??0}</small></h2>
      <div className="table-scroll"><table><thead><tr><th>Staked</th><th>Net paid out</th><th>Platform net</th><th>Observed RTP</th><th>Sample</th><th>Average / largest round wager</th><th>Largest payout</th></tr></thead><tbody><tr><td>{formatNumber(g.staked)}</td><td>{formatNumber(g.paid)}</td><td>{formatNumber(g.net)}</td><td>{g.observed==null?'No settled stakes':(g.observed*100).toFixed(3)+'%'}</td><td>{g.rounds.toLocaleString()} rounds · {g.playerRounds.toLocaleString()} player-rounds · {g.players.toLocaleString()} players</td><td>{formatNumber(g.averageBet)} / {formatNumber(g.largestBet)}</td><td>{formatNumber(g.largestPayout)}</td></tr></tbody></table></div>
      <p>Configured reporting target: {(g.config.targetRtp*100).toFixed(3)}% (not an RNG control). Modeled equal-area RTP: {g.model.average==null?'Not available':(g.model.average*100).toFixed(3)+'%'}{g.model.average!=null?` · modeled house edge ${((1-g.model.average)*100).toFixed(3)}%`:''}.</p><p>{g.model.note}</p>
      {g.model.areas.length>0&&<div className="table-scroll"><table><thead><tr><th>Bet area</th><th>Probability</th><th>Net win return × stake</th><th>Single-area theoretical RTP</th></tr></thead><tbody>{g.model.areas.map(a=><tr key={a.label}><td>{a.label}</td><td>{(a.probability*100).toFixed(4)}%</td><td>{a.netReturn.toFixed(4)}</td><td>{(a.rtp*100).toFixed(3)}%</td></tr>)}</tbody></table></div>}
      {g.alert&&<Notice type="info">{g.alert}</Notice>}
      <p>Bet volume: {g.playerRounds.toLocaleString()} settled player-rounds. {g.recentPlayers} distinct settled players in the last 5 minutes within this range; this is activity, not a claim of current online presence.</p>
      <EconomyEditor game={g.game} config={g.config}/></Card>)}
    <Card><h2>Immutable configuration history · latest 50</h2>{data.history.length?data.history.map(h=><details key={`${h.game_name}:${h.version}`}><summary>{String(h.game_name)} · v{String(h.version)} · {formatIst(h.effective_at)} · Master {String(h.actor_id)}</summary><p>{String(h.reason)}</p><div className="form-grid"><div><h3>Previous</h3><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(typeof h.previous_config==='string'?JSON.parse(h.previous_config):h.previous_config,null,2)}</pre></div><div><h3>Published</h3><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(typeof h.config_json==='string'?JSON.parse(h.config_json):h.config_json,null,2)}</pre></div></div></details>):<p>No versioned changes published yet. Version 0 identifies the preserved deployment baseline.</p>}</Card>
  </>;
}
