"""Guard one already-tested repository patch; no DB or configuration writes."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess

root = Path('/opt/nazraa/app-next')
target = root / 'lib/db/repositories/mobile-product.ts'
before = '744f65263309871f27b6ebe85f05f26e9dc8fecc44587f84355bb1677406cbc5'
after = 'd7be96ee71056c4ff8f68dce7028d6a04af25d6e60c576afa31d900ecf80a469'
assert os.geteuid() == 0
assert hashlib.sha256(target.read_bytes()).hexdigest() == before, 'Unexpected production source; do not overwrite'
assert subprocess.check_output(['systemctl', 'show', 'nazraa-backup.service', '-p', 'ActiveState', '--value'], text=True).strip() == 'inactive'
assert subprocess.check_output(['systemctl', 'show', 'nazraa-backup.service', '-p', 'Result', '--value'], text=True).strip() == 'success'
log = subprocess.check_output(['journalctl', '-u', 'nazraa-backup.service', '--since', '-20 minutes', '--grep', 'Offsite backup verified', '-n', '1', '--no-pager'], text=True)
assert 'Offsite backup verified' in log, 'Fresh verified offsite backup required'
backup = Path('/opt/nazraa/backups/lucky87-retry')
assert not backup.exists(), 'Do not overwrite rollback'
backup.mkdir(mode=0o700)
shutil.copy2(target, backup / 'mobile-product.ts')
shutil.copy2('/opt/nazraa/compose.yaml', backup / 'compose.yaml')
image = subprocess.check_output(['docker', 'inspect', 'nazraa-api-1', '--format', '{{.Image}}'], text=True).strip()
(backup / 'previous-api-image.txt').write_text(image + '\n')
(backup / 'offsite-backup.txt').write_text(log)
subprocess.run(['docker', 'tag', image, 'nazraa-api:rollback-before-lucky87-retry'], check=True)
patch = '''diff --git a/lib/db/repositories/mobile-product.ts b/lib/db/repositories/mobile-product.ts
--- a/lib/db/repositories/mobile-product.ts
+++ b/lib/db/repositories/mobile-product.ts
@@ -1460,6 +1460,15 @@ function canonicalBets(bets: Record<string, number>) {
   return Object.fromEntries(Object.entries(bets).sort(([left], [right]) => left.localeCompare(right)));
 }
 
+function canonicalSharedRetryBets(game: string, bets: Record<string, number>) {
+  // These two games store all allowed areas, including zero wagers. A sparse
+  // immutable retry must compare equal to that durable expanded receipt.
+  // Keep unknown keys/changed values so they still fail the equality check.
+  if (game === "luck77") return canonicalBets({watermelon: 0, seven: 0, plum: 0, ...bets});
+  if (game === TEEN_PATTI_ID) return canonicalBets({green: 0, blue: 0, red: 0, ...bets});
+  return canonicalBets(bets);
+}
+
 function checkedBets(bets: Record<string, number>, keys: readonly string[], unit: number, maximum = 50_000_000) {
   const allowed = new Set(keys);
   if (Object.keys(bets).some((key) => !allowed.has(key))) throw new Error("This game bet contains an invalid option.");
@@ -2274,7 +2283,7 @@ async function sharedRoundStatePayload(
       "SELECT wager_total, gross_payout, deduction_total, payout_total, balance_after, settled_at FROM game_shared_settlements WHERE round_id = ? AND application_user_id = ? LIMIT 1", [round.id, identity.userId]),
     connection.query<SharedRoundRow[]>(
       `SELECT * FROM game_shared_rounds WHERE game_name = ? AND drawing_ends_at <= UTC_TIMESTAMP(3)
-       ORDER BY round_number DESC LIMIT ?`, [game, Math.max(1, Math.min(50, config.historyLength))]),
+       ORDER BY ${game === "luck77" ? "drawing_ends_at DESC, id DESC" : "round_number DESC"} LIMIT ?`, [game, Math.max(1, Math.min(50, config.historyLength))]),
     connection.query<RowDataPacket[]>(
       `SELECT round.id round_id, round.round_number, round.outcome_json,
               settlement.wager_total, settlement.gross_payout,
@@ -2426,7 +2435,7 @@ export async function placeSharedGameBets(identity: MobileIdentity, input: {
       [identity.userId, input.requestId],
     );
     if (existingRows[0]) {
-      if (String(existingRows[0].round_id) !== input.roundId || JSON.stringify(canonicalBets(asObject(existingRows[0].bets_json) as Record<string, number>)) !== JSON.stringify(bets)) {
+      if (String(existingRows[0].round_id) !== input.roundId || JSON.stringify(canonicalSharedRetryBets(game, asObject(existingRows[0].bets_json) as Record<string, number>)) !== JSON.stringify(canonicalSharedRetryBets(game, bets))) {
         throw new Error("This bet request ID was already used.");
       }
       return sharedRoundStatePayload(connection, identity, round, config, now);
'''
subprocess.run(['git', 'apply', '--check', '-'], cwd=root, input=patch, text=True, check=True)
subprocess.run(['git', 'apply', '-'], cwd=root, input=patch, text=True, check=True)
assert hashlib.sha256(target.read_bytes()).hexdigest() == after
(backup / 'applied.patch').write_text(patch)
for item in backup.iterdir():
    item.chmod(0o600)
print('LUCKY87_RETRY_STAGED; source/image rollback protected; services unchanged')
