export const liveStartReasons = ['ROLE_NOT_ALLOWED','ACCOUNT_SUSPENDED','LIVE_PERMISSION_DISABLED','ROOM_LIMIT_REACHED','TOKEN_FAILED','SESSION_CREATE_FAILED','POLICY_ACCEPTANCE_REQUIRED','VERIFICATION_REQUIRED','AGENCY_REQUIRED','LIVE_HOURS_CLOSED','DATABASE_UNAVAILABLE'] as const;
export type LiveStartReason = typeof liveStartReasons[number];
/** Fixed diagnostics only: never store the SQL, token, personal data or stack. */
export function liveStartReason(error:unknown):LiveStartReason {
 const e=error as {code?:string;accessCode?:string;message?:string}|null;
 const code=String(e?.code??e?.accessCode??''), message=String(e?.message??'');
 if(code==='POLICY_ACCEPTANCE_REQUIRED')return code;
 if(/ER_|ECONN|ETIMEDOUT|PROTOCOL/.test(code)||/database|mysql|connection pool/i.test(message))return 'DATABASE_UNAVAILABLE';
 if(/banned|suspended|hosting is suspended|hosting.*inactive/i.test(message+code))return 'ACCOUNT_SUSPENDED';
 if(/role cannot|role.*not allowed/i.test(message))return 'ROLE_NOT_ALLOWED';
 if(/verified face|face verification/i.test(message))return 'VERIFICATION_REQUIRED';
 if(/approved Agency|Agency.*unlock|Agency.*required/i.test(message))return 'AGENCY_REQUIRED';
 if(/maximum.*room|room.*limit|too many.*rooms/i.test(message))return 'ROOM_LIMIT_REACHED';
 if(/available from|time window|streaming is available/i.test(message))return 'LIVE_HOURS_CLOSED';
 if(/token|media.*prepared/i.test(message))return 'TOKEN_FAILED';
 if(/restricted|permission|disabled/i.test(message))return 'LIVE_PERMISSION_DISABLED';
 return 'SESSION_CREATE_FAILED';
}
export function recordLiveStartDenial(error:unknown,kind:string,role:string){
 const reasonCode=liveStartReason(error);
 console.warn('LIVE_START_DENIED',JSON.stringify({kind,role,reasonCode}));
 if(error instanceof Error&&Object.isExtensible(error))Object.assign(error,{liveStartReason:reasonCode});
 return error;
}
