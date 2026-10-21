/** Generate a private deployment artifact, never environment values/secrets. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';

const root=resolve(import.meta.dirname,'..');
const baseline='cd08af8f2dfb048e352c39239a498aac5e11bd62';
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim();
const paths=execFileSync('git',['diff','--name-only',baseline,commit],{cwd:root}).toString().trim().split('\n').filter(path=>/^(app|components|lib)\//.test(path));
if(paths.length!==8)throw new Error('Unexpected deployment scope');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=paths.map(path=>{
  const contents=execFileSync('git',['show',`${commit}:${path}`],{cwd:root});
  if(digest(readFileSync(join(root,path)))!==digest(contents))throw new Error(`Uncommitted source: ${path}`);
  let before=null;
  try {before=digest(execFileSync('git',['show',`${baseline}:${path}`],{cwd:root,stdio:['ignore','pipe','ignore']}));}catch{}
  return {path,before,after:digest(contents),contents:contents.toString('base64')};
});
const capsule={baseline,commit,files,stateScript:readFileSync(join(root,'scripts/qa-master-financial-state.cjs')).toString('base64')};
const directory=mkdtempSync(join(tmpdir(),'nazraa-allocation-'));
writeFileSync(join(directory,'capsule.json.gz'),gzipSync(Buffer.from(JSON.stringify(capsule))),{mode:0o600});
writeFileSync(join(directory,'deploy.py'),readFileSync(join(root,'scripts/deploy-master-allocation-20261021.py')),{mode:0o600});
console.log(JSON.stringify({directory,commit,files:files.length}));
