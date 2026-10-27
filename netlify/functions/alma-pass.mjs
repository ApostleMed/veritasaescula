// GET /api/alma/pass?t=r_<id>.<hmac>
// Returns the ticket for a signed pass link (used by /alma/pass/<token>).
import { store, verify, ticketView, json } from '../lib/alma.mjs';

export const config = { path: '/api/alma/pass' };

export default async req => {
  const id = verify(new URL(req.url).searchParams.get('t'), 'r', 'pass');
  if (!id) return json({ error: 'This ticket link is not valid.' }, 404);
  const rec = await store().get(`reg/${id}`, { type: 'json' });
  if (!rec) return json({ error: 'This ticket could not be found.' }, 404);
  return json({ ticket: await ticketView(rec) });
};
