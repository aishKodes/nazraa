import { businessDateFor, businessDayUtcRange } from './live-business-policy';

export const partyBoardTargets = { dailySeconds: 50*60, monthlySeconds: 20*3600, monthlyValidDays: 24 } as const;
export function splitPartyBoardInterval(start:Date,end:Date,timezone:string) {
  const parts:{date:string;milliseconds:number;start:Date;end:Date}[]=[];
  let cursor=start.getTime();
  while(cursor<end.getTime()) {
    const at=new Date(cursor),bounds=businessDayUtcRange(timezone,at);
    const until=Math.min(end.getTime(),bounds.endsAt.getTime());
    if(until<=cursor) throw new Error('Invalid Party Board day boundary.');
    parts.push({date:businessDateFor(timezone,at),milliseconds:until-cursor,start:at,end:new Date(until)});
    cursor=until;
  }
  return parts;
}
export function partyBoardSummary(days:{date:string;milliseconds:number}[],today:string) {
  const month=today.slice(0,7),monthly=days.filter(d=>d.date.startsWith(month));
  const seconds=(rows:typeof days)=>Math.floor(rows.reduce((sum,d)=>sum+d.milliseconds,0)/1000);
  const todaySeconds=seconds(days.filter(d=>d.date===today));
  const monthlySeconds=seconds(monthly);
  const validDays=monthly.filter(d=>d.milliseconds>=partyBoardTargets.dailySeconds*1000).length;
  return {totalSeconds:seconds(days),todaySeconds,dailyTargetSeconds:partyBoardTargets.dailySeconds,
    todayRemainingSeconds:Math.max(0,partyBoardTargets.dailySeconds-todaySeconds),dailyCompleted:todaySeconds>=partyBoardTargets.dailySeconds,
    monthlySeconds,monthlyTargetSeconds:partyBoardTargets.monthlySeconds,
    monthlyRemainingSeconds:Math.max(0,partyBoardTargets.monthlySeconds-monthlySeconds),validDays,
    validDayTarget:partyBoardTargets.monthlyValidDays,remainingValidDays:Math.max(0,partyBoardTargets.monthlyValidDays-validDays),
    monthlyCompleted:monthlySeconds>=partyBoardTargets.monthlySeconds&&validDays>=partyBoardTargets.monthlyValidDays};
}
