// Sequential, independently verified installations. Never retries a failed write automatically.
export async function runBatchInstall(items, { install, onProgress = () => {}, shouldStop = () => false }) {
  const results = [];
  for (const item of items) {
    if (shouldStop()) break;
    onProgress({ results: [...results], current: item, total: items.length });
    try {
      const routes = await install(item);
      results.push({ ...item, status: "Installed", routes });
    } catch (error) {
      results.push({ ...item, status: "Failed", message: error.message || String(error) });
    }
    onProgress({ results: [...results], current: null, total: items.length });
  }
  return { results, total: items.length, stopped: results.length < items.length };
}
