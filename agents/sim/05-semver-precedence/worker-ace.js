function parse(version) {
  const [core, ...pre] = version.split("+")[0].split("-");
  return { core: core.split(".").map(Number), pre: pre.length ? pre.join("-").split(".") : [] };
}

function compareIdentifier(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Math.sign(Number(a) - Number(b));
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a, b) {
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) if (A.core[i] !== B.core[i]) return A.core[i] < B.core[i] ? -1 : 1;
  if (!A.pre.length || !B.pre.length) return A.pre.length ? -1 : B.pre.length ? 1 : 0;
  for (let i = 0; i < Math.min(A.pre.length, B.pre.length); i++) {
    const c = compareIdentifier(A.pre[i], B.pre[i]);
    if (c) return c;
  }
  return Math.sign(A.pre.length - B.pre.length);
}
