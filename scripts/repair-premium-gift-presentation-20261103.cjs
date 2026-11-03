/** Repair only verified V6 video presentation metadata; never wallet/price/rules. */
(async()=>{
 const {randomUUID,createHash}=require('node:crypto'),mysql=require('mysql2/promise');
 const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
 try{
 await c.beginTransaction();
 const [before]=await c.query('SELECT id,gift_key,coin_price,currency,economy_type,active FROM gift_catalog ORDER BY id');
 const [rows]=await c.query("SELECT id,asset_config FROM gift_catalog WHERE JSON_UNQUOTE(JSON_EXTRACT(asset_config,'$.visualPackVersion'))='gift-v6-20261103' AND JSON_UNQUOTE(JSON_EXTRACT(asset_config,'$.assetType'))='VIDEO' AND gift_key NOT LIKE 'qa_%' FOR UPDATE");
 if(rows.length!==133)throw Error('EXPECTED_VERIFIED_133_VIDEO_GIFTS');
 let repaired=0;
 for(const row of rows){
 const a=typeof row.asset_config==='string'?JSON.parse(row.asset_config):row.asset_config;
 const u=new URL(a.assetUrl);const m=u.pathname.match(/^\/api\/v1\/assets\/gifts\/([a-f0-9-]{36})\.mp4$/i);
 if(!m||!['api.nazraa.pixtra.site','nazralive.in','127.0.0.1','10.0.2.2'].includes(u.hostname))throw Error('UNVERIFIED_VIDEO_LOCATION');
 const [assets]=await c.query('SELECT mime_type,image_data,byte_size,checksum_sha256 FROM gift_assets WHERE id=?',[m[1]]);const asset=assets[0];
 if(!asset||asset.mime_type!=='video/mp4'||!Buffer.isBuffer(asset.image_data)||asset.image_data.length!==Number(asset.byte_size)||Number(asset.byte_size)>3*1024*1024)throw Error('UNVERIFIED_VIDEO_ASSET');
 const sha=createHash('sha256').update(asset.image_data).digest('hex');if(sha!==asset.checksum_sha256||(/^[a-f0-9]{64}$/i.test(a.assetChecksum??'')&&a.assetChecksum!==sha))throw Error('VIDEO_CHECKSUM_MISMATCH');
 if(a.videoPresentation==='BOUNDED_CINEMATIC')continue;
 if(process.argv.includes('--apply')){
  const next={...a,videoPresentation:'BOUNDED_CINEMATIC'};
  await c.execute('UPDATE gift_catalog SET asset_config=? WHERE id=?',[JSON.stringify(next),row.id]);
  await c.execute("INSERT INTO audit_logs(id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason) VALUES(?,'SYSTEM','gift.bounded_video_repair','gifts','gift',?,?,?,?)",[randomUUID(),row.id,JSON.stringify({videoPresentation:a.videoPresentation??null}),JSON.stringify({videoPresentation:next.videoPresentation,verifiedAssetChecksum:sha}),'Owner completion: verified V6 MP4 plays only within the existing bounded cinematic renderer; financial fields unchanged.']);
 }
 repaired++;
 }
 const [after]=await c.query('SELECT id,gift_key,coin_price,currency,economy_type,active FROM gift_catalog ORDER BY id');if(JSON.stringify(before)!==JSON.stringify(after))throw Error('FINANCIAL_FIELDS_CHANGED');
 if(process.argv.includes('--apply'))await c.commit();else await c.rollback();
 console.log(JSON.stringify({mode:process.argv.includes('--apply')?'APPLIED':'DRY_RUN',verifiedVideos:rows.length,repaired,financialFieldsUnchanged:true,unboundedVideoGuardPreserved:true}));
 }catch(e){await c.rollback();console.error(e.code||e.message||'VIDEO_REPAIR_FAILED');process.exitCode=1;}finally{await c.end();}
})().catch(()=>{console.error('VIDEO_REPAIR_FAILED');process.exitCode=1});
