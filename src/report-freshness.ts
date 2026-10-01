/** Observation age advances even when an upstream fetch fails. */
export function reportWithin(time: unknown, now: number, hours: number): boolean {
  if (typeof time !== "string") return false;
  const observed = Date.parse(time);
  const age = now - observed;
  return Number.isFinite(age) && age >= -5 * 60_000 && age <= hours * 3_600_000;
}
