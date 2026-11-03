/** Passive production Redis observation: no bets, SQL writes or financial repair. */
const {createClient}=require('redis');
(async()=>{
  const client=createClient({url:process.env.REDIS_URL});client.on('error',()=>{});
  await client.connect();const events=[];
  await client.subscribe(['game:teen_patti','game:teen_patti_pro'],(raw)=>{
    const data=JSON.parse(raw),s=data.state;
    if(data.reason!=='ROUND'||!s?.round)return;
    events.push({receivedAt:new Date().toISOString(),game:s.game,roundId:s.round.id,roundNumber:s.round.number,phase:s.round.phase,lifecycle:s.round.lifecycle,phaseEndsAt:s.round.phaseEndsAt,outcomePresent:!!s.outcome,winningItemId:s.winningItemId??null});
  });
  await new Promise(r=>setTimeout(r,46000));await client.unsubscribe();await client.quit();
  const summary=Object.fromEntries(['teen_patti','teen_patti_pro'].map(game=>{
    const rows=events.filter(e=>e.game===game),phases=[...new Set(rows.map(e=>e.phase))];
    const results=rows.filter(e=>e.phase==='RESULT');
    return [game,{events:rows.length,rounds:new Set(rows.map(e=>e.roundId)).size,phases,authoritativeResults:results.length,resultsHaveOutcome:results.length>0&&results.every(e=>e.outcomePresent&&e.winningItemId!==null)}];
  }));
  console.log(JSON.stringify({readOnly:true,durationSeconds:46,summary,events},null,2));
  if(!Object.values(summary).every(s=>s.phases.includes('BETTING')&&s.phases.includes('DRAWING')&&s.resultsHaveOutcome))process.exitCode=1;
})().catch(e=>{console.error(e.code||e.name);process.exit(1)});
