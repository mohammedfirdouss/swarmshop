const UNITS = { h: 3600, m: 60, s: 1 };

export function parseDuration(input) {
  const match = /^(\d+)([hms])$/.exec(input.trim());
  if (!match) throw new Error(`bad duration: ${input}`);
  return Number(match[1]) * UNITS[match[2]];
}
