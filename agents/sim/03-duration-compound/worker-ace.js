const UNITS = { h: 3600, m: 60, s: 1 };

export function parseDuration(input) {
  const text = input.trim();
  if (!/^(\d+[hms])+$/.test(text)) throw new Error(`bad duration: ${input}`);
  let total = 0;
  for (const [, n, unit] of text.matchAll(/(\d+)([hms])/g)) total += Number(n) * UNITS[unit];
  return total;
}
