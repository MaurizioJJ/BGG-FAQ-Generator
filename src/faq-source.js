export function datasetForExpansions(dataset, expansionIds) {
  const selected = new Set(expansionIds);
  return { ...dataset, threads: dataset.threads.filter(thread => !thread.component?.id || selected.has(thread.component.id)) };
}
