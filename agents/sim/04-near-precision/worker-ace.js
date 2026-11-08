const CENT = 10n ** 22n;

export function formatNear(yocto) {
  const cents = (BigInt(yocto) + CENT / 2n) / CENT;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")} NEAR`;
}
