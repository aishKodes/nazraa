/** Calendar reporting boundaries in IST, represented as UTC instants for SQL. */
export function rankingPeriod(period:'daily'|'weekly'|'monthly',now=new Date()){
  const ist=new Date(now.getTime()+330*60000),year=ist.getUTCFullYear(),month=ist.getUTCMonth(),day=ist.getUTCDate();
  let start=Date.UTC(year,month,period==='monthly'?1:day);
  if(period==='weekly')start-=((ist.getUTCDay()+6)%7)*86400000;
  const end=period==='monthly'?Date.UTC(year,month+1,1):start+(period==='weekly'?7:1)*86400000;
  return {start:new Date(start-330*60000),end:new Date(end-330*60000),businessMonth:`${year}-${String(month+1).padStart(2,'0')}`};
}
