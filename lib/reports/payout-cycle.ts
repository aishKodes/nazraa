const businessDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
});
const monthLabel = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });

export function currentPayoutCycle(now = new Date()) {
  const parts = Object.fromEntries(businessDate.formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${Number(parts.day) <= 15 ? 1 : 2}`;
}

export function payoutCycle(id: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-([12])$/.exec(id);
  if (!match) throw Error("Choose a valid IST payout cycle.");
  const [, y, m, half] = match;
  const year = Number(y), month = Number(m);
  if (year < 1900 || year > 9998) throw Error("Choose a valid IST payout cycle.");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = half === "1" ? "01" : "16";
  const end = half === "1" ? 15 : last;
  const move = (offset: number) => new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
  return {
    id,
    from: `${y}-${m}-${start}`, to: `${y}-${m}-${end}`,
    label: `${Number(start)}–${end} ${monthLabel.format(new Date(Date.UTC(year, month - 1, 1)))}`,
    previous: half === "1" ? `${move(-1)}-2` : `${y}-${m}-1`,
    next: half === "1" ? `${y}-${m}-2` : `${move(1)}-1`,
  };
}
