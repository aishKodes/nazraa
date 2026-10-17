/** One server-time checkpoint policy, shared by Host heartbeats and signed
 * provider transitions. Fractional milliseconds remain in the cursor rather
 * than being discarded on every successful heartbeat. No client time/input. */
export function publishingCheckpoint(input:{
  wasPublishing:boolean; publishingNow:boolean; previousEvidence:Date|null;
  serverTime:Date; evidenceWindowSeconds:number;
}){
  const {serverTime,previousEvidence,wasPublishing,publishingNow}=input;
  const gap=previousEvidence==null?Infinity:serverTime.getTime()-previousEvidence.getTime();
  if(gap<0) return {seconds:0,cursor:previousEvidence};
  const supported=wasPublishing&&gap>=0&&gap<=Math.min(30,input.evidenceWindowSeconds)*1000;
  const seconds=supported?Math.floor(gap/1000):0;
  // Keep the original fractional offset while continuously publishing. A
  // recovered segment starts NOW: unobserved/offline time never gets added.
  const cursor=publishingNow
    ? supported?new Date(previousEvidence!.getTime()+seconds*1000):serverTime
    : previousEvidence;
  return {seconds,cursor};
}
