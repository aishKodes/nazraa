// The current Vercel schedule is 18:35 UTC daily. Its database operation is
// idempotent. Keep this worker dormant until the new database is authoritative.
const endpoint = "http://api:3000/api/cron/monthly-host-reset";
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET is required for the VPS worker.");

let stopped = false;
let timer;

function nextDelay() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(18, 35, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

async function run() {
  const response = await fetch(endpoint, {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Scheduled job returned ${response.status}.`);
  console.log(`Monthly Host reset check completed at ${new Date().toISOString()}.`);
}

function schedule(delay = nextDelay()) {
  if (stopped) return;
  timer = setTimeout(async () => {
    try {
      await run();
      schedule();
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Scheduled job failed.");
      schedule(15 * 60_000);
    }
  }, delay);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopped = true;
    clearTimeout(timer);
    process.exit(0);
  });
}

schedule();
