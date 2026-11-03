import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import type {RowDataPacket} from 'mysql2/promise';
import {db} from '@/lib/db/pool';
import {withTransaction} from '@/lib/db/transaction';
import {publicAssetOrigin} from '@/lib/config/public-api-origin';
import type {Scope} from '@/types/platform';
import type {PreparedPublicImage} from '@/lib/security/public-images';
export const premiumRoleFamilies=['owner','admin','super_admin','official','agency','cs','bd','country_manager','country_super_admin','coin_seller','manager','global_manager','host_royal','host_diamond','host_neon_luxe','host_fire'] as const;
type Visual={assetUrl:string;assetChecksum:string;portraitScale:number;portraitOffsetY:number;entryDurationMs:number;enabled:boolean};
function parse(v:unknown):Record<string,Visual>{try{return typeof v==='string'?JSON.parse(v):v&&typeof v==='object'?v as Record<string,Visual>:{};}catch{return {};}}
export async function premiumRoleVisualSettings(){const [rows]=await db().query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='mobile.role_visuals.v6'");return parse(rows[0]?.setting_value);}
export async function savePremiumRoleVisual(input:{scope:Scope;family:string;image?:PreparedPublicImage;portraitScale:number;portraitOffsetY:number;entryDurationMs:number;enabled:boolean;reason:string}){
 if(input.scope.account.role!=='MASTER')throw Error('Only Master may manage role artwork.');
 if(!premiumRoleFamilies.includes(input.family as never)||!Number.isFinite(input.portraitScale)||input.portraitScale<.15||input.portraitScale>1||!Number.isFinite(input.portraitOffsetY)||Math.abs(input.portraitOffsetY)>.3||!Number.isInteger(input.entryDurationMs)||input.entryDurationMs<2000||input.entryDurationMs>5000||input.reason.trim().length<5||input.reason.length>500)throw Error('Choose valid artwork settings and a change reason.');
 await withTransaction(async c=>{
 await c.execute("INSERT IGNORE INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.role_visuals.v6','{}',?)",[input.scope.account.id]);const [rows]=await c.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='mobile.role_visuals.v6' FOR UPDATE");const values=parse(rows[0].setting_value),previous=values[input.family];let assetUrl=previous?.assetUrl,checksum=previous?.assetChecksum;
 if(input.image){const i=input.image;if(i.data.length!==i.byteSize||i.byteSize>1024*1024||i.mimeType!=='image/webp')throw Error('Choose a validated WebP frame.');checksum=createHash('sha256').update(i.data).digest('hex');const [same]=await c.query<RowDataPacket[]>('SELECT id FROM gift_assets WHERE checksum_sha256=? LIMIT 1',[checksum]);const id=same[0]?.id??randomUUID();if(!same[0])await c.execute('INSERT INTO gift_assets(id,mime_type,image_data,byte_size,original_name,uploaded_by,checksum_sha256) VALUES(?,?,?,?,?,?,?)',[id,i.mimeType,i.data,i.byteSize,i.originalName,input.scope.account.id,checksum]);assetUrl=`${publicAssetOrigin()}/api/v1/assets/gifts/${id}`;}
 if(!assetUrl||!checksum)throw Error('Upload the original frame before saving its overrides.');
 const next={assetUrl,assetChecksum:checksum,portraitScale:input.portraitScale,portraitOffsetY:input.portraitOffsetY,entryDurationMs:input.entryDurationMs,enabled:input.enabled};if(previous&&Object.entries(next).every(([key,value])=>previous[key as keyof Visual]===value))return;values[input.family]=next;
 await c.execute("UPDATE system_settings SET setting_value=?,updated_by=? WHERE setting_key='mobile.role_visuals.v6'",[JSON.stringify(values),input.scope.account.id]);
 await c.execute("INSERT INTO audit_logs(id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason) VALUES(?,?,'MASTER','cosmetics.role_visual','gifts','role_visual',?,?,?,?)",[randomUUID(),input.scope.account.id,input.family,JSON.stringify(previous??null),JSON.stringify(next),input.reason.trim()]);
 });
}
export async function premiumRoleManifestRows(){const values=await premiumRoleVisualSettings();return premiumRoleFamilies.flatMap(family=>{const v=values[family];if(!v||!/^https:\/\//.test(v.assetUrl??'')||!/^[a-f0-9]{64}$/.test(v.assetChecksum??''))return [];return ['frame','entry'].map(kind=>({gift_key:`role_v6_${family}_${kind}`,name:family.replaceAll('_',' '),category:'ROLE',catalog_type:kind==='frame'?'AVATAR_FRAME':'ENTRY_EFFECT',visual_url:v.assetUrl,animation_key:null,updated_at:v.assetChecksum,asset_config:{assetType:'STATIC_IMAGE',assetChecksum:v.assetChecksum,assetVersion:v.assetChecksum,portraitScale:v.portraitScale,portraitOffsetY:v.portraitOffsetY,frameAnimationStyle:`sculpted_${family}`,durationMs:v.entryDurationMs,presentationTier:'PREMIUM',displayMode:'FULL',gameBehavior:'COMPACT',modalBehavior:'COMPACT',enabled:v.enabled}}));});}
