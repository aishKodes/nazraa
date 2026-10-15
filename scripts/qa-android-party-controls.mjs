// Owner-authorized Android UIAutomator checks on the existing emulator only.
import {execFileSync} from 'node:child_process';
const adb='/Users/aishwaryam/Library/Android/sdk/platform-tools/adb';
function run(args){return execFileSync(adb,['-s','emulator-5556',...args],{encoding:'utf8'});}
function snapshot(){run(['shell','uiautomator','dump','/sdcard/party-controls.xml']);return run(['shell','cat','/sdcard/party-controls.xml']);}
function tap(label){
 const xml=snapshot();const node=[...xml.matchAll(/<node\b[^>]*>/g)].map(m=>m[0]).find(n=>n.includes(`content-desc="${label}"`));
 if(!node)throw new Error(`Expected visible control missing: ${label}`);
 const bounds=/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);if(!bounds)throw new Error('Missing tap bounds');
 run(['shell','input','tap',String(Math.round((+bounds[1]+ +bounds[3])/2)),String(Math.round((+bounds[2]+ +bounds[4])/2))]);
 console.log(`Tapped ${label}`);
}
for(const label of process.argv.slice(2))tap(label);
const end=snapshot();
console.log(JSON.stringify({visibleSeat20:end.includes('Seat 20'),visibleSeat10:end.includes('Seat 10'),roomStillOpen:end.includes('Leave room')}));
