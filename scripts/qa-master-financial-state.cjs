// Read-only deployment evidence. Never print credentials, balances or contacts.
const mysql=require('mysql2/promise');
const {createHash}=require('node:crypto');
(async()=>{
  const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  try {
    const [migrations]=await c.query('SELECT COUNT(*) total,MAX(name) latest FROM control_schema_migrations');
    const [config]=await c.query("SELECT setting_key,setting_value FROM system_settings ORDER BY setting_key");
    const [foreignKeys]=await c.query("SELECT TABLE_NAME tableName,DELETE_RULE deleteRule FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='platform_accounts' ORDER BY TABLE_NAME,CONSTRAINT_NAME");
    const [clock]=await c.query('SELECT @@session.time_zone sessionTimezone,@@system_time_zone systemTimezone,UTC_TIMESTAMP(3) utcNow');
    console.log(JSON.stringify({migrations:migrations[0],settingsSha256:createHash('sha256').update(JSON.stringify(config)).digest('hex'),accountForeignKeys:foreignKeys,clock:clock[0]}));
  } finally {await c.end();}
})().catch(()=>{console.error('READ_ONLY_SNAPSHOT_FAILED');process.exitCode=1;});
