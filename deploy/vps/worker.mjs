// The VPS is the only production writer. Financial resets retain their
// idempotent daily schedule; stale-room cleanup no longer runs in Home.
const monthlyEndpoint = "http://api:3000/api/cron/monthly-host-reset";
const roomMaintenanceEndpoint = "http://api:3000/api/cron/room-maintenance";
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET is required for the VPS worker.");

let stopped = false;
let monthlyTimer;
let roomMaintenanceTimer;
let roomMaintenanceInFlight = false;

function nextDelay() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(18, 35, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

async function run(endpoint) {
  const response = await fetch(endpoint, {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Scheduled job returned ${response.status}.`);
}

function scheduleMonthly(delay = nextDelay()) {
  if (stopped) return;
  monthlyTimer = setTimeout(async () => {
    try {
      await run(monthlyEndpoint);
      scheduleMonthly();
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Scheduled job failed.");
      scheduleMonthly(15 * 60_000);
    }
  }, delay);
}

function scheduleRoomMaintenance(delay = 60_000) {
  if (stopped) return;
  roomMaintenanceTimer = setTimeout(async () => {
    if (stopped) return;
    if (roomMaintenanceInFlight) {
      scheduleRoomMaintenance();
      return;
    }
    roomMaintenanceInFlight = true;
    try {
      await run(roomMaintenanceEndpoint);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Room maintenance failed.");
    } finally {
      roomMaintenanceInFlight = false;
      scheduleRoomMaintenance();
    }
  }, delay);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopped = true;
    clearTimeout(monthlyTimer);
    clearTimeout(roomMaintenanceTimer);
    process.exit(0);
  });
}

scheduleMonthly();
scheduleRoomMaintenance(5_000);
