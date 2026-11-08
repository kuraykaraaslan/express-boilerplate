/**
 * For tests that answer the app's GET requests with a stubbed global `fetch` (`vi.stubGlobal('fetch', …)`): an axios stand-in whose
 * `get` reads through that `fetch`, with the arguments a bare read sends (`url`, `{ headers }`), resolving `{ data, status }` for an
 * answer and rejecting the way axios does (`response: { status, data }`) for a refusal. The remote pickers read through the app's API
 * client since e2e run 1 (E7: the refresh of an expired session), so a test that stubs `fetch` mocks the client with this:
 *
 *   vi.mock('@kuraykaraaslan-labs/common/server/axios', async () => (await import('@kuraykaraaslan-labs/common/server/axios/axios.test-utils')).axiosOverFetchModule())
 *
 * A stubbed answer without `ok` or `status` counts as an answer (the older stubs give only `json`).
 */
export async function getOverFetch(url: string, config?: { headers?: Record<string, string> }): Promise<{ data: unknown; status: number }> {
  const r = await fetch(url, { headers: config?.headers ?? {} });
  const data: unknown = await r.json();
  const status = typeof r.status === 'number' ? r.status : 200;
  if (r.ok === false || status >= 400) {
    throw Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
  }
  return { data, status };
}

/** The module mock of `@kuraykaraaslan-labs/common/server/axios` over `getOverFetch` (only `get` is answered). */
export const axiosOverFetchModule = () => ({ default: { get: getOverFetch } });
