import 'server-only';
import {randomUUID} from 'node:crypto';
import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {db} from '@/lib/db/pool';
import {withTransaction} from '@/lib/db/transaction';
import type {Scope} from '@/types/platform';
import {canonicalCountryCode} from '@/lib/countries';

function master(scope:Scope){if(scope.account.role!=='MASTER'||!scope.isGlobal)throw Error('Only Master can manage Global Managers and country groups.');}
function reason(value:string){if(value.trim().length<5||value.trim().length>500)throw Error('Enter a reason of 5–500 characters.');return value.trim();}
async function audit(c:PoolConnection,scope:Scope,action:string,id:string,previous:unknown,next:unknown,why:string){await c.execute(`INSERT INTO audit_logs(id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason) VALUES(?,?,'MASTER',?,'global_management','management_scope',?,?,?,?)`,[randomUUID(),scope.account.id,action,id,JSON.stringify(previous),JSON.stringify(next),why]);}
async function validCountries(c:PoolConnection,values:string[]){const codes=[...new Set(values.map(canonicalCountryCode))].sort();const [rows]=await c.query<RowDataPacket[]>('SELECT code FROM management_countries');if(codes.some(code=>!rows.some(r=>r.code===code)))throw Error('Choose canonical countries from the country list.');return codes;}

export async function globalManagement(scope:Scope){
 master(scope);
 const [[countries],[groups],[members],[managers],[direct],[assignedGroups],[team]]=await Promise.all([
  db().query<RowDataPacket[]>('SELECT code,name FROM management_countries ORDER BY name'),
  db().query<RowDataPacket[]>('SELECT id,name,active,version FROM country_groups ORDER BY name'),
  db().query<RowDataPacket[]>('SELECT group_id,country_code FROM country_group_countries'),
  db().query<RowDataPacket[]>(`SELECT a.id,a.public_id,a.full_name,a.status,a.application_user_id,u.public_id nazraa_public_id,COALESCE(s.version,0) version,COALESCE(s.game_reports_enabled,1) game_reports_enabled FROM platform_accounts a LEFT JOIN application_users u ON u.id=a.application_user_id LEFT JOIN global_manager_assignments s ON s.manager_id=a.id WHERE a.role='GLOBAL_MANAGER' AND a.removed_at IS NULL ORDER BY a.full_name`),
  db().query<RowDataPacket[]>('SELECT manager_id,country_code FROM global_manager_countries'),
  db().query<RowDataPacket[]>('SELECT manager_id,group_id FROM global_manager_country_groups'),
  db().query<RowDataPacket[]>(`SELECT c.id,c.public_id,c.full_name,c.country_code,c.parent_account_id,p.role parent_role FROM platform_accounts c LEFT JOIN platform_accounts p ON p.id=c.parent_account_id WHERE c.role='COUNTRY_MANAGER' AND c.removed_at IS NULL ORDER BY c.full_name`),
 ]);
 return {countries:countries.map(r=>({code:String(r.code),name:String(r.name)})),groups:groups.map(r=>({id:String(r.id),name:String(r.name),active:!!r.active,version:Number(r.version),countries:members.filter(m=>m.group_id===r.id).map(m=>String(m.country_code))})),managers:managers.map(r=>({id:String(r.id),publicId:String(r.public_id),name:String(r.full_name),status:String(r.status),applicationUserId:r.application_user_id?String(r.application_user_id):null,applicationUserPublicId:r.nazraa_public_id?String(r.nazraa_public_id):null,version:Number(r.version),gamesEnabled:!!r.game_reports_enabled,countries:direct.filter(d=>d.manager_id===r.id).map(d=>String(d.country_code)),groups:assignedGroups.filter(g=>g.manager_id===r.id).map(g=>String(g.group_id)),countryManagers:team.filter(t=>t.parent_account_id===r.id).map(t=>String(t.id))})),team:team.map(r=>({id:String(r.id),publicId:String(r.public_id),name:String(r.full_name),country:String(r.country_code??''),parentId:r.parent_account_id?String(r.parent_account_id):null,parentRole:String(r.parent_role??'')}))};
}

export async function saveCountryGroup(scope:Scope,input:{id?:string;name:string;active:boolean;countries:string[];expectedVersion:number;reason:string}){
 master(scope);const why=reason(input.reason);const name=input.name.trim();if(name.length<2||name.length>100)throw Error('Choose a group name of 2–100 characters.');
 return withTransaction(async c=>{
  const codes=await validCountries(c,input.countries);if(!codes.length)throw Error('Choose at least one country.');
  const id=input.id||randomUUID();const [existing]=await c.query<RowDataPacket[]>('SELECT * FROM country_groups WHERE id=? FOR UPDATE',[id]);
  if(input.id&&!existing[0])throw Error('Country group not found.');
  if(Number(existing[0]?.version??0)!==input.expectedVersion)throw Error('Country group changed. Reload before saving.');
  const [before]=await c.query<RowDataPacket[]>('SELECT country_code FROM country_group_countries WHERE group_id=?',[id]);
  if(existing[0])await c.execute('UPDATE country_groups SET name=?,active=?,version=version+1 WHERE id=?',[name,input.active,id]);
  else await c.execute('INSERT INTO country_groups(id,name,active,created_by) VALUES(?,?,?,?)',[id,name,input.active,scope.account.id]);
  await c.execute('DELETE FROM country_group_countries WHERE group_id=?',[id]);
  for(const code of codes)await c.execute('INSERT INTO country_group_countries(group_id,country_code) VALUES(?,?)',[id,code]);
  await audit(c,scope,'country_group.save',id,{...existing[0],countries:before.map(r=>r.country_code)},{name,active:input.active,countries:codes,version:input.expectedVersion+1},why);
  return id;
 });
}

export async function saveGlobalManager(scope:Scope,input:{id:string;name:string;status:'ACTIVE'|'SUSPENDED';countries:string[];groups:string[];countryManagers:string[];gamesEnabled:boolean;expectedVersion:number;reason:string}){
 master(scope);const why=reason(input.reason);if(input.name.trim().length<2||input.name.trim().length>120||!['ACTIVE','SUSPENDED'].includes(input.status))throw Error('Choose a valid name and status.');
 return withTransaction(async c=>{
  // Serialize assignment changes; a manager can never claim another team's Country Manager.
  const [target]=await c.query<RowDataPacket[]>(`SELECT id,full_name,status FROM platform_accounts WHERE id=? AND role='GLOBAL_MANAGER' AND removed_at IS NULL FOR UPDATE`,[input.id]);
  if(!target[0])throw Error('Global Manager not found.');
  await c.execute('INSERT IGNORE INTO global_manager_assignments(manager_id) VALUES(?)',[input.id]);
  const [versions]=await c.query<RowDataPacket[]>('SELECT version,game_reports_enabled FROM global_manager_assignments WHERE manager_id=? FOR UPDATE',[input.id]);
  if(Number(versions[0].version)!==input.expectedVersion)throw Error('Global Manager changed. Reload before saving.');
  const countries=await validCountries(c,input.countries),groups=[...new Set(input.groups)].sort(),team=[...new Set(input.countryManagers)].sort();
  const [availableGroups]=await c.query<RowDataPacket[]>('SELECT id,active FROM country_groups FOR UPDATE');
  if(groups.some(g=>!availableGroups.some(r=>r.id===g)))throw Error('Choose existing country groups.');
  const [beforeCountries]=await c.query<RowDataPacket[]>('SELECT country_code FROM global_manager_countries WHERE manager_id=?',[input.id]);
  const [beforeGroups]=await c.query<RowDataPacket[]>('SELECT group_id FROM global_manager_country_groups WHERE manager_id=?',[input.id]);
  const [rows]=await c.query<RowDataPacket[]>(`SELECT c.id,c.country_code,c.parent_account_id,p.role parent_role FROM platform_accounts c JOIN platform_accounts p ON p.id=c.parent_account_id WHERE c.role='COUNTRY_MANAGER' AND c.removed_at IS NULL ORDER BY c.id FOR UPDATE`);
  const [derived]=groups.length?await c.query<RowDataPacket[]>(`SELECT gc.country_code FROM country_group_countries gc JOIN country_groups g ON g.id=gc.group_id AND g.active=TRUE WHERE g.id IN (${groups.map(()=>'?').join(',')})`,groups):[[]];
  const effective=new Set([...countries,...derived.map(r=>String(r.country_code))]);
  for(const id of team){const cm=rows.find(r=>r.id===id);if(!cm||cm.parent_account_id!==input.id&&cm.parent_role!=='MASTER')throw Error('Country Manager belongs to another Global Manager or is unavailable.');if(cm.parent_account_id!==input.id&&!effective.has(String(cm.country_code)))throw Error('Assign the Country Manager country before adding this team.');}
  for(const row of rows){if(row.parent_account_id===input.id&&!team.includes(String(row.id)))await c.execute('UPDATE platform_accounts SET parent_account_id=? WHERE id=?',[scope.account.id,row.id]);}
  for(const id of team)await c.execute('UPDATE platform_accounts SET parent_account_id=? WHERE id=?',[input.id,id]);
  await c.execute('DELETE FROM global_manager_countries WHERE manager_id=?',[input.id]);
  for(const code of countries)await c.execute('INSERT INTO global_manager_countries(manager_id,country_code) VALUES(?,?)',[input.id,code]);
  await c.execute('DELETE FROM global_manager_country_groups WHERE manager_id=?',[input.id]);
  for(const group of groups)await c.execute('INSERT INTO global_manager_country_groups(manager_id,group_id) VALUES(?,?)',[input.id,group]);
  await c.execute('UPDATE platform_accounts SET full_name=?,status=? WHERE id=?',[input.name.trim(),input.status,input.id]);
  await c.execute('UPDATE global_manager_assignments SET version=version+1,game_reports_enabled=? WHERE manager_id=?',[input.gamesEnabled,input.id]);
  await audit(c,scope,'global_manager.scope',input.id,{...target[0],countries:beforeCountries.map(r=>r.country_code),groups:beforeGroups.map(r=>r.group_id),countryManagers:rows.filter(r=>r.parent_account_id===input.id).map(r=>r.id),...versions[0]},{...input,reason:undefined,version:input.expectedVersion+1},why);
 });
}
