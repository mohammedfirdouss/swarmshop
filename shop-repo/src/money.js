export function formatNear(yocto) {
  return (Number(yocto) / 1e24).toFixed(2) + " NEAR";
}
