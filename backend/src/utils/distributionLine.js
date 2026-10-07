export function distributionLinePath(sourceRow) {
  const line = sourceRow - 1;
  const groupStart = Math.floor((line - 1) / 50) * 50 + 1;
  return `/distribution/groupe/${groupStart}/ligne/${line}`;
}
