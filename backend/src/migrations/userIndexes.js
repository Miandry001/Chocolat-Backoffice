export async function removeUniqueUserLoginIndexes(collection) {
  const legacyLoginFields = new Set(["login", "usernameKey"]);
  const indexes = await collection.indexes().catch((error) => {
    if (error.code === 26) return [];
    throw error;
  });
  const obsoleteIndexes = indexes.filter((index) => index.unique
    && Object.keys(index.key ?? {}).some((field) => legacyLoginFields.has(field)));

  for (const index of obsoleteIndexes) {
    await collection.dropIndex(index.name);
  }

  return obsoleteIndexes.map(({ name }) => name);
}
