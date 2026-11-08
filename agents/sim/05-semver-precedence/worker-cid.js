function parse(version) {
  const [core, pre = ""] = version.split("+")[0].split("-");
  return { core: core.split(".").map(Number), pre };
}

export function compareVersions(a, b) {
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) if (A.core[i] !== B.core[i]) return A.core[i] < B.core[i] ? -1 : 1;
  if (A.pre === B.pre) return 0;
  if (!A.pre || !B.pre) return A.pre ? -1 : 1;
  return A.pre < B.pre ? -1 : 1;
}
