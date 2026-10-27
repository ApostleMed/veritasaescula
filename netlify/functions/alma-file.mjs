// GET /api/alma/file?t=f_<id>.<hmac>
// Admissions-only link (sent to the Google Sheet) to a student's uploaded results.
import { uploads, verify } from '../lib/alma.mjs';

export const config = { path: '/api/alma/file' };

export default async req => {
  const id = verify(new URL(req.url).searchParams.get('t'), 'f', 'file');
  if (!id) return new Response('Not found', { status: 404 });
  const hit = await uploads().getWithMetadata(id, { type: 'arrayBuffer' });
  if (!hit) return new Response('Not found', { status: 404 });
  return new Response(hit.data, {
    headers: {
      'content-type': hit.metadata?.type || 'application/octet-stream',
      'content-disposition': `inline; filename="${String(hit.metadata?.name || 'results').replace(/[^\w.-]/g, '_')}"`,
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
    },
  });
};
