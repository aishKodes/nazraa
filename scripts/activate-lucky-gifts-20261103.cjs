/** Owner-authorized Lucky catalog activation. Existing gift prices/rules untouched. */
(async()=>{
 const {randomUUID,createHash}=require('node:crypto'),mysql=require('mysql2/promise');
 const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 try{await c.beginTransaction();
 const [masters]=await c.query("SELECT id FROM platform_accounts WHERE role='MASTER' AND status='ACTIVE' LIMIT 1");if(!masters[0])throw Error('MASTER_REQUIRED');
 const financial="SELECT id,gift_key,coin_price,currency,economy_type,active FROM gift_catalog ORDER BY id";
 const [before]=await c.query(financial);const ids=new Set(before.map(r=>r.id));
 const definitions=[{key:'lucky_heart',source:'heart',packSource:'2ca095da-c6c8-4d6b-85c0-cecdf3e036ca',name:'Lucky Heart'},{key:'lucky_rose',source:'rose',packSource:'e7e57807-3430-464a-be7f-63c8bb929a2e',name:'Lucky Rose'},{key:'lucky_crown_of_love',source:'09204814-202b-4bf5-858a-0b194cc13b71',name:'Lucky Crown of Love'}];let created=0;
 for(const d of definitions){
  const [existing]=await c.query('SELECT economy_type FROM gift_catalog WHERE gift_key=? FOR UPDATE',[d.key]);if(existing.length){if(existing[0].economy_type!=='LUCKY')throw Error('CATALOG_KEY_CONFLICT');continue;}
  const [source]=await c.query("SELECT * FROM gift_catalog WHERE (gift_key=? OR JSON_UNQUOTE(JSON_EXTRACT(asset_config,'$.visualPackSourceId'))=?) AND active=TRUE AND catalog_type='VIRTUAL_GIFT' AND economy_type='NORMAL' ORDER BY gift_key=? DESC LIMIT 1",[d.source,d.packSource??d.source,d.source]);const g=source[0];if(!g||!g.visual_url||Number(g.coin_price)<100)throw Error('VERIFIED_SOURCE_GIFT_REQUIRED');
  const a=typeof g.asset_config==='string'?JSON.parse(g.asset_config):g.asset_config??{};
  if(a.visualPackVersion!=='gift-v6-20261103')throw Error('VERIFIED_V6_ASSET_REQUIRED');
  await c.execute(`INSERT INTO gift_catalog(id,gift_key,name,category,catalog_type,economy_type,emoji,coin_price,currency,validity_days,visual_url,animation_key,asset_config,active,sort_order,created_by)
   VALUES(?,?,?,'Lucky','VIRTUAL_GIFT','LUCKY',?,?,'COIN',0,?,?,?,TRUE,?,?)`,[randomUUID(),d.key,d.name,g.emoji,g.coin_price,g.visual_url,g.animation_key,JSON.stringify({...a,minimumAppVersion:'2.5.14',durationMs:2800,presentationTier:'PREMIUM',displayMode:'FULL',luckySourceGift:d.source}),-100+created,masters[0].id]);created++;
 }
 const [settings]=await c.query("SELECT setting_value FROM system_settings WHERE setting_key='mobile.lucky_gifts' FOR UPDATE");
 const previous=settings[0]?(typeof settings[0].setting_value==='string'?JSON.parse(settings[0].setting_value):settings[0].setting_value):null;
 const defaults={enabled:true,winBps:2500,receiverBps:2000,companyBps:8000,minimumGrossCoins:1,version:1,tiers:[[1000,40000],[2000,30000],[5000,20000],[10000,7000],[20000,2000],[50000,600],[100000,200],[120000,80],[130000,50],[180000,30],[200000,30],[250000,10]].map(([multiplierBps,weight])=>({id:'tier_'+multiplierBps,rewardType:'MULTIPLIER',multiplierBps,weight,enabled:true}))};
 const next=previous?{...previous,enabled:true,version:previous.enabled?previous.version:previous.version+1}:defaults;
 if(next.winBps!==2500||next.receiverBps!==2000||next.companyBps!==8000)throw Error('UNEXPECTED_LUCKY_POLICY');
 if(JSON.stringify(previous)!==JSON.stringify(next))await c.execute("INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.lucky_gifts',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",[JSON.stringify(next),masters[0].id]);
 const [after]=await c.query(financial);if(JSON.stringify(before)!==JSON.stringify(after.filter(r=>ids.has(r.id))))throw Error('EXISTING_FINANCIAL_FIELDS_CHANGED');
 if(created||JSON.stringify(previous)!==JSON.stringify(next))await c.execute("INSERT INTO audit_logs(id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason) VALUES(?,'SYSTEM','gifts.lucky_activation','gifts','system_setting','mobile.lucky_gifts',?,?,?)",[randomUUID(),JSON.stringify(previous),JSON.stringify({policy:next,definitions}), 'Owner-authorized complete Lucky Gift activation; source catalog prices retained; receiver 20%, company 80%, independent 25% CSPRNG win; existing normal gifting untouched.']);
 await c.commit();console.log(JSON.stringify({created,luckyEnabled:true,version:next.version,normalGiftsUnchanged:true,catalogBeforeDigest:createHash('sha256').update(JSON.stringify(before)).digest('hex')}));
 }catch(e){await c.rollback();console.error(e.code||e.message||'LUCKY_ACTIVATION_FAILED');process.exitCode=1;}finally{await c.end();}
})().catch(()=>{console.error('LUCKY_ACTIVATION_FAILED');process.exitCode=1;});
