import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Keep the deployed POS profile intact; local backends get independent data. */
export function resolveApiUserDataPath(
  userData: string,
  apiUrl: string,
): string {
  const url = new URL(apiUrl);
  const local =
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    url.hostname === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/u.test(url.hostname);
  if (!local) return userData;

  // Include the port and API base path: separate local databases must not share
  // catalog IDs, authorization, or the durable receipt outbox.
  const key = createHash('sha256')
    .update(url.href.replace(/\/+$/u, ''))
    .digest('hex');
  return join(userData, 'local-api', key);
}
