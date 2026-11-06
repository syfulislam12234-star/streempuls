/** Stop every owned stream before releasing worker resources. */
export async function stopStreamsThenClose({ streamIds, stopStream, closeResources }) {
  const results = await Promise.all(streamIds.map((streamId) => stopStream(streamId)));
  if (results.some((stopped) => stopped !== true)) return false;
  await closeResources();
  return true;
}