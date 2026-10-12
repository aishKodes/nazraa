import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import mysql from 'mysql2/promise';
// Disposable local role fixtures only. No production environment is loaded.
async function main(){
const database=process.env.NAZRAA_QA_DATABASE??'';
if(!/^nazraa_control_qa_\d+$/.test(database))throw new Error('Choose a retained isolated local QA database.');
const user='qa_ui_'+randomBytes(6).toString('hex');const password=randomBytes(24).toString('hex');
const root=await mysql.createConnection({host:'127.0.0.1',user:'root'});
await root.query(`CREATE USER '${user}'@'localhost' IDENTIFIED BY '${password}'`);
await root.query(`GRANT ALL ON \`${database}\`.* TO '${user}'@'localhost'`);
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{
  env:{...process.env,NODE_ENV:'production',DB_HOST:'127.0.0.1',DB_NAME:database,DB_USER:user,DB_PASSWORD:password,DB_SSL:'false',DB_PORT:'3306',SESSION_SECRET:'nazraa-local-only-qa-session-secret-20260830',REDIS_URL:'',LIVEKIT_API_KEY:'',LIVEKIT_API_SECRET:''},stdio:'inherit'});
let closing=false;
async function cleanup(){if(closing)return;closing=true;server.kill('SIGTERM');await root.query(`DROP USER IF EXISTS '${user}'@'localhost'`);await root.end();process.exit(0);}
process.on('SIGINT',()=>void cleanup());process.on('SIGTERM',()=>void cleanup());server.on('exit',()=>void cleanup());
}
main().catch(error=>{console.error(error);process.exitCode=1;});
