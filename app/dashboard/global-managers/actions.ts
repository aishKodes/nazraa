'use server';
import {revalidatePath} from 'next/cache';
import {requirePermission} from '@/lib/auth/guard';
import {saveCountryGroup,saveGlobalManager} from '@/lib/db/repositories/global-management';
export type ManagementState={error?:string;success?:string};
export async function managementAction(_:ManagementState,form:FormData):Promise<ManagementState>{
 const scope=await requirePermission('accounts.roles');
 try{
  if(scope.account.role!=='MASTER')throw Error('Only Master can manage Global Managers and country groups.');
  const why=String(form.get('reason')??'');
  if(form.get('confirmed')!=='yes')throw Error('Confirm the scope changes before saving.');
  if(form.get('kind')==='group')await saveCountryGroup(scope,{id:String(form.get('id')??'')||undefined,name:String(form.get('name')??''),active:form.get('active')==='yes',countries:form.getAll('countries').map(String),expectedVersion:Number(form.get('version')),reason:why});
  else await saveGlobalManager(scope,{id:String(form.get('id')??''),name:String(form.get('name')??''),status:form.get('status')==='SUSPENDED'?'SUSPENDED':'ACTIVE',countries:form.getAll('countries').map(String),groups:form.getAll('groups').map(String),countryManagers:form.getAll('countryManagers').map(String),gamesEnabled:form.get('gamesEnabled')==='yes',expectedVersion:Number(form.get('version')),reason:why});
  revalidatePath('/dashboard','layout');return {success:'Saved. Country and team permissions are effective on the next request.'};
 }catch(e){const message=e instanceof Error?e.message:'';return {error:/^(Only Master|Enter |Choose |Country |Global Manager|Assign |Confirm )/.test(message)?message:'The scope could not be saved. Reload and retry; a duplicate group name may already exist.'};}
}
