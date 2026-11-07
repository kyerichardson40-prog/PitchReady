import { ProviderError } from './types.ts';

/**
 * fetch with a hard timeout. Classifies failures:
 *  - network error before any response → 'failed' (request most likely never processed)
 *  - timeout/abort after sending        → 'uncertain' (provider may have accepted and billed it)
 *  - HTTP error response                → 'failed' with status code
 */
export async function providerFetch(url: string, init: RequestInit, timeoutMs: number, label: string): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) {
      // Read and discard the body; never surface provider error text to clients.
      await res.text().catch(() => '');
      throw new ProviderError('failed', `${label}_http_${res.status}`, `${label} returned HTTP ${res.status}`);
    }
    return res;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if ((e as Error)?.name === 'AbortError') throw new ProviderError('uncertain', `${label}_timeout`, `${label} timed out`);
    throw new ProviderError('failed', `${label}_network`, `${label} not reachable`);
  } finally {
    clearTimeout(timer);
  }
}
