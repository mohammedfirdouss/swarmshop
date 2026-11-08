const UNITS = { h: 3600, m: 60, s: 1 };

export function parseDuration(input) {
  let total = 0;
  for (const [, n, unit] of input.trim().matchAll(/(\d+)([hms])/g)) total += Number(n) * UNITS[unit];
  return total;
}
