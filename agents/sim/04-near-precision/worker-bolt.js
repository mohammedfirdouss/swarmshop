export function formatNear(yocto) {
  return (Math.floor(Number(yocto) / 1e22) / 100).toFixed(2) + " NEAR";
}
