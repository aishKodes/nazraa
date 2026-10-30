import 'server-only';
import {randomUUID} from 'node:crypto';
import type {RowDataPacket} from 'mysql2';
import type {PoolConnection} from 'mysql2/promise';
import {db} from '@/lib/db/pool';
import {withTransaction} from '@/lib/db/transaction';
import {configurableGameIds,mobileGamesConfig,effectiveMobileGamesConfig,type MobileGamesConfig,type ConfigurableGameId,type GameRuntimeConfig} from '@/lib/games/game-config';
import {economyDraft,economyModel,type EconomyDraft} from '@/lib/games/economy-policy';
import type {Scope} from '@/types/platform';

export function requireGameEconomy(scope:Scope){if(scope.account.role!=='MASTER')throw new Error('Only Master may manage global game economics.');}
/** Called from both legacy Settings and the new preview/publish workflow. */
export async function recordGameConfigVersion(c:PoolConnection,scope:Scope,game:ConfigurableGameId,settings:MobileGamesConfig,previous:GameRuntimeConfig,reason:string){
  requireGameEconomy(scope);
  if(reason.trim().length<5||reason.length>500)throw new Error('Enter a change reason of 5–500 characters.');
  const next=settings.games[game];next.economyVersion=(previous.economyVersion??0)+1;
  // Cover the deployment window in which an older API instance could still
  // have opened a table without the additive snapshot columns populated.
  // Only pending/current metadata is frozen; no outcome or settled row moves.
  const frozen=JSON.stringify({...previous,runtimeSnapshotVersion:1});
  await c.execute(`UPDATE game_shared_rounds r SET r.config_json=?,r.config_version=?
    WHERE r.game_name=? AND r.config_json IS NULL AND r.betting_starts_at>=UTC_TIMESTAMP(3)-INTERVAL 1 DAY AND r.result_ends_at>UTC_TIMESTAMP(3)`,[frozen,previous.economyVersion??0,game]);
  await c.execute(`UPDATE game_shared_rounds r JOIN (
      SELECT DISTINCT b.round_id FROM game_shared_bets b LEFT JOIN game_shared_settlements s ON s.round_id=b.round_id AND s.application_user_id=b.application_user_id
      WHERE b.game_name=? AND s.id IS NULL) pending ON pending.round_id=r.id
    SET r.config_json=?,r.config_version=? WHERE r.config_json IS NULL`,[game,frozen,previous.economyVersion??0]);
  await c.execute(`INSERT INTO game_config_versions(game_name,version,previous_config,config_json,actor_account_id,reason,effective_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
    [game,next.economyVersion,JSON.stringify(previous),JSON.stringify(next),scope.account.id,reason.trim()]);
  const [stored]=await c.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='mobile.games' FOR UPDATE");
  const raw=typeof stored[0]?.setting_value==='string'?JSON.parse(stored[0].setting_value):stored[0]?.setting_value??{};
  const merged={...raw,games:{...raw.games,[game]:next}};
  await c.execute(`INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.games',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)`,[JSON.stringify(merged),scope.account.id]);
  await c.execute(`INSERT INTO audit_logs(id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason) VALUES(?,?,'MASTER','game.economy_publish','games','game_config',?,?,?,?)`,
    [randomUUID(),scope.account.id,game,JSON.stringify(previous),JSON.stringify(next),reason.trim()]);
}
export async function currentGameEconomy(scope:Scope){
  requireGameEconomy(scope);
  const [rows]=await db().query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='mobile.games'");
  const [history]=await db().query<RowDataPacket[]>(`SELECT v.game_name,v.version,v.previous_config,v.config_json,v.reason,v.effective_at,a.public_id actor_id,a.full_name actor_name
    FROM game_config_versions v JOIN platform_accounts a ON a.id=v.actor_account_id ORDER BY v.effective_at DESC LIMIT 50`);
  return {settings:effectiveMobileGamesConfig(rows[0]?.setting_value),history};
}
export async function previewGameEconomy(scope:Scope,game:ConfigurableGameId,draft:EconomyDraft){
  const {settings}=await currentGameEconomy(scope),current=settings.games[game];
  const proposed=economyDraft(game,current,draft);
  return {game,current,proposed,model:economyModel(game,proposed),expectedVersion:current.economyVersion??0,effective:'First new round after publication; current rounds retain their snapshot.'};
}
export async function publishGameEconomy(scope:Scope,game:ConfigurableGameId,draft:EconomyDraft,expectedVersion:number,reason:string){
  requireGameEconomy(scope);
  return withTransaction(async c=>{
    await c.execute("INSERT IGNORE INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.games',?,?)",[JSON.stringify(mobileGamesConfig({})),scope.account.id]);
    const [rows]=await c.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='mobile.games' FOR UPDATE");
    const settings=effectiveMobileGamesConfig(rows[0].setting_value),previous=settings.games[game];
    if((previous.economyVersion??0)!==expectedVersion)throw new Error('Configuration changed. Preview the latest configuration again.');
    settings.games[game]=economyDraft(game,previous,draft);
    await recordGameConfigVersion(c,scope,game,settings,previous,reason);
    return settings.games[game].economyVersion!;
  });
}

export function economyRange(period:string,from?:string,to?:string,now=new Date()){
  const date=(s:string,end=false)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new Error('Choose a valid date range.');const d=new Date(s+'T00:00:00+05:30');if(!Number.isFinite(d.getTime())||new Date(d.getTime()+330*60000).toISOString().slice(0,10)!==s)throw new Error('Choose a valid date range.');if(end)d.setUTCDate(d.getUTCDate()+1);return d;};
  const today=new Date(now.getTime()+330*60000).toISOString().slice(0,10);
  const end=period==='custom'?date(to??'',true):now;
  const start=period==='custom'?date(from??''):period==='today'?date(today):new Date(now.getTime()-(period==='7d'?7:30)*86400000);
  if(start>=end||end.getTime()-start.getTime()>366*86400000)throw new Error('Choose a valid date range of at most 366 days.');
  return {start,end};
}
export async function gameEconomyDashboard(scope:Scope,period='today',from?:string,to?:string){
  requireGameEconomy(scope);const range=economyRange(period,from,to);
  const {settings,history}=await currentGameEconomy(scope);
  const [rows]=await db().query<RowDataPacket[]>(`SELECT r.game_name,COUNT(*) player_rounds,
    COUNT(DISTINCT COALESCE(s.round_id,r.client_round_id)) rounds,COUNT(DISTINCT r.application_user_id) players,
    SUM(r.wager_total) staked,SUM(r.payout_total) paid,AVG(r.wager_total) average_bet,MAX(r.wager_total) largest_bet,MAX(r.payout_total) largest_payout,
    COUNT(DISTINCT CASE WHEN r.created_at>=UTC_TIMESTAMP(3)-INTERVAL 5 MINUTE THEN r.application_user_id END) recent_players
    FROM game_round_results r LEFT JOIN game_shared_settlements s ON s.result_record_id=r.id
    WHERE r.created_at>=? AND r.created_at<? AND r.wager_total>0 GROUP BY r.game_name`,[range.start,range.end]);
  return {history,settings,range,games:configurableGameIds.map(game=>{
    const r=rows.find(r=>r.game_name===game),config=settings.games[game],staked=Number(r?.staked??0),paid=Number(r?.paid??0),rounds=Number(r?.rounds??0),model=economyModel(game,config);
    return {game,config,model,staked,paid,net:staked-paid,observed:staked?paid/staked:null,rounds,players:Number(r?.players??0),playerRounds:Number(r?.player_rounds??0),averageBet:Number(r?.average_bet??0),largestBet:Number(r?.largest_bet??0),largestPayout:Number(r?.largest_payout??0),recentPlayers:Number(r?.recent_players??0),
      alert:rounds<1000?'Small sample: variance can dominate; no economy action is implied.':staked&&model.average!=null&&paid/staked>model.average+.10?'INVESTIGATE: observed return exceeds the current modeled equal-area return by more than 10 percentage points. Check historical versions, selection mix and concentration; this is not a statistical significance test.':paid>staked?'INVESTIGATE: net payout exceeds stakes. Review large wins and historical versions; outcomes are never manipulated.':null};
  })};
}
