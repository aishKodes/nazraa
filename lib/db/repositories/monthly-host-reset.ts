import 'server-only';
import {rankingPeriod} from '@/lib/policy/ranking-period';
/** Existing cron/bootstrap compatibility. Reporting rollover never mutates
 * wallets. Historical reset, reward and financial records remain intact. */
export async function runMonthlyHostEarningsReset(now=new Date()){
  const period=rankingPeriod('monthly',now);
  return {resetMonth:period.businessMonth+'-01',status:'rankings_period_only',affectedUsers:0,expiredAmount:0};
}
