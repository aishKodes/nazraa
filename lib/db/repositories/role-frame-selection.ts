import 'server-only';
import {randomUUID} from 'node:crypto';
import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {db} from '@/lib/db/pool';
import type {Scope} from '@/types/platform';
import {withTransaction} from '@/lib/db/transaction';
import {premiumRoleVisualSettings} from './premium-role-visuals';
const defaults={"owner": {"label": "OWNER", "accent": 4294955404, "portraitScale": 0.515, "portraitOffsetY": 0.002}, "admin": {"label": "ADMIN", "accent": 4293375333, "portraitScale": 0.576, "portraitOffsetY": -0.0156}, "super_admin": {"label": "SUPER ADMIN", "accent": 4290502136, "portraitScale": 0.528, "portraitOffsetY": 0.0195}, "official": {"label": "OFFICIAL", "accent": 4293846990, "portraitScale": 0.552, "portraitOffsetY": 0.0254}, "agency": {"label": "AGENCY", "accent": 4285835765, "portraitScale": 0.56, "portraitOffsetY": -0.0215}, "cs": {"label": "CS", "accent": 4284931583, "portraitScale": 0.515, "portraitOffsetY": 0.0488}, "bd": {"label": "BD", "accent": 4285456801, "portraitScale": 0.524, "portraitOffsetY": -0.0098}, "country_manager": {"label": "COUNTRY MANAGER", "accent": 4285508091, "portraitScale": 0.459, "portraitOffsetY": -0.0039}, "country_super_admin": {"label": "COUNTRY SUPER ADMIN", "accent": 4291025151, "portraitScale": 0.483, "portraitOffsetY": 0.0254}, "coin_seller": {"label": "COIN SELLER", "accent": 4294956413, "portraitScale": 0.576, "portraitOffsetY": 0.0078}, "manager": {"label": "MANAGER", "accent": 4291207927, "portraitScale": 0.556, "portraitOffsetY": 0.0137}, "global_manager": {"label": "GLOBAL MANAGER", "accent": 4291550452, "portraitScale": 0.511, "portraitOffsetY": 0.043}, "host_royal": {"label": "HOST ROYAL", "accent": 4294939565, "portraitScale": 0.471, "portraitOffsetY": -0.0391}, "host_diamond": {"label": "HOST DIAMOND", "accent": 4288735743, "portraitScale": 0.536, "portraitOffsetY": -0.0332}, "host_neon_luxe": {"label": "HOST NEON LUXE", "accent": 4294154751, "portraitScale": 0.576, "portraitOffsetY": -0.0039}, "host_fire": {"label": "HOST FIRE", "accent": 4294941274, "portraitScale": 0.532, "portraitOffsetY": 0.0078}} as const;
const roleFamily:Record<string,string>={MASTER:'owner',ADMIN:'admin',SUPER_ADMIN:'super_admin',AGENCY:'agency',BD:'bd',MONITORING_CS:'cs',COUNTRY_MANAGER:'country_manager',COIN_SELLER:'coin_seller'};
const hostFamilies=['host_royal','host_diamond','host_neon_luxe','host_fire'];
export type RoleFrameState={selected:string|null;allowed:string[];publicId:string;disabled:boolean};
function grants(value:unknown):string[]{try{const v=typeof value==='string'?JSON.parse(value):value;return Array.isArray(v)?v.filter(f=>typeof f==='string'&&Object.hasOwn(defaults,f)):[];}catch{return [];}}
export async function roleFrameStates(executor:PoolConnection|ReturnType<typeof db>,ids:readonly string[]){
 const result=new Map<string,RoleFrameState>();if(!ids.length)return result;
 const [rows]=await executor.query<RowDataPacket[]>(`SELECT u.public_id,u.is_host,u.equipped_role_frame,u.role_frame_grants,a.role FROM application_users u
 LEFT JOIN platform_accounts a ON a.status='ACTIVE' AND a.removed_at IS NULL AND
 (a.application_user_id=u.id OR a.application_user_id=u.external_user_id OR a.application_user_id=CAST(u.public_id AS CHAR))
 WHERE u.public_id IN (${ids.map(()=>'?').join(',')}) AND u.account_status='ACTIVE' ORDER BY a.id`,[...ids]);
 for(const r of rows){const id=String(r.public_id),value=result.get(id)??{publicId:id,selected:r.equipped_role_frame,disabled:r.equipped_role_frame==='NONE',allowed:[...grants(r.role_frame_grants),...(r.is_host?hostFamilies:[])]};const f=roleFamily[r.role];if(f)value.allowed.push(f);value.allowed=[...new Set(value.allowed)];result.set(id,value);}
 return result;
}
export async function roleFramePresentation(family:string,executor:PoolConnection|ReturnType<typeof db>=db(),overrides?:Awaited<ReturnType<typeof premiumRoleVisualSettings>>){
 const base=defaults[family as keyof typeof defaults];if(!base)throw Error('Choose an available frame.');
 const remote=(overrides??await premiumRoleVisualSettings(executor))[family];
 return {itemId:`role_v6_${family}_frame`,name:base.label,type:'AVATAR_FRAME',source:'ROLE',accent:base.accent,
 visualUrl:remote?.enabled?remote.assetUrl:`assets/premium/role-v6/${family}.webp`,animationKey:null,
 effectConfig:({assetType:'STATIC_IMAGE',portraitScale:remote?.portraitScale??base.portraitScale,portraitOffsetY:remote?.portraitOffsetY??base.portraitOffsetY,
 frameAnimationStyle:`sculpted_${family}`,assetVersion:remote?.assetChecksum??'role-v6-20261103'} as Record<string,unknown>)};
}
export async function roleFrameOptions(state:RoleFrameState,executor:PoolConnection|ReturnType<typeof db>=db()){
 const overrides=state.allowed.length?await premiumRoleVisualSettings(executor):{};
 const presentations=await Promise.all(state.allowed.map(f=>roleFramePresentation(f,executor,overrides)));
 return {catalog:presentations.map(p=>({id:p.itemId,name:p.name,type:'AVATAR_FRAME',symbol:'♛',cost:0,currency:'COIN',validityDays:0,vipTierEligibility:null,enabled:true,sortOrder:-100,category:'Role frames',visualUrl:p.visualUrl,animationKey:null,assetConfig:p.effectConfig})),
 entitlements:state.allowed.map(f=>({id:`role-frame:${f}`,itemId:`role_v6_${f}_frame`,source:'ROLE',acquiredAt:'2026-11-03T00:00:00.000Z',expiresAt:'2999-12-31T23:59:59.000Z',equipped:state.selected===f})),
 selected:state.selected&&state.allowed.includes(state.selected)?await roleFramePresentation(state.selected,executor,overrides):null};
}
/** Master grants decoration only. Never writes a platform role or permission. */
export async function grantRoleFrame(scope:Scope,input:{publicId:string;family:string;grant:boolean;reason:string}){
 if(scope.account.role!=='MASTER')throw Error('Only Master may grant role artwork.');
 if(!Object.hasOwn(defaults,input.family)||!/^\d{1,20}$/.test(input.publicId)||input.reason.trim().length<5||input.reason.length>500)throw Error('Choose a user, frame and reason.');
 await withTransaction(async c=>{
 const [rows]=await c.query<RowDataPacket[]>("SELECT id,role_frame_grants,equipped_role_frame FROM application_users WHERE public_id=? AND account_status='ACTIVE' FOR UPDATE",[input.publicId]);
 if(!rows[0])throw Error('Active user not found.');const before=grants(rows[0].role_frame_grants),after=input.grant?[...new Set([...before,input.family])]:before.filter(f=>f!==input.family);
 await c.execute('UPDATE application_users SET role_frame_grants=?,equipped_role_frame=CASE WHEN ?=FALSE AND equipped_role_frame=? THEN NULL ELSE equipped_role_frame END WHERE id=?',[JSON.stringify(after),input.grant,input.family,rows[0].id]);
 await c.execute("INSERT INTO audit_logs(id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason) VALUES(?,?,'MASTER','cosmetics.role_frame_grant','gifts','application_user',?,?,?,?)",[randomUUID(),scope.account.id,rows[0].id,JSON.stringify(before),JSON.stringify(after),input.reason.trim()]);
 });
}
