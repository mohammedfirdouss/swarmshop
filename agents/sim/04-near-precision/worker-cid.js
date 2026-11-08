export function formatNear(yocto) {
  const cents = BigInt(yocto) / 10n ** 22n;
  return `${cents / 100n}.${cents % 100n} NEAR`;
}
