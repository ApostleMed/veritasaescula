// Shared helpers for the ALMA diagnostic registration functions.
// Secrets (Brevo key, signing secret, BCC address) come only from Netlify
// environment variables; the repository is public, so never hard-code them.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import QRCode from 'qrcode';

export const SITE = 'https://veritasaescula.com';

export const EVENT = {
  date: '21 December 2026 (Tentative)',
  dateLong: 'Monday, 21 December 2026',
  time: '1:00 PM – 4:00 PM MMT',
  checkIn: '1:00 PM – 1:30 PM MMT',
  exam: '1:30 PM – 3:00 PM MMT',
  ceremony: '3:00 PM – 4:00 PM MMT',
};

export const CENTERS = {
  YGN: 'Yangon',
  MDY: 'Mandalay',
  TGI: 'Taunggyi',
  TCL: 'Tachileik',
  ONL: 'Online Exam Center',
};

export const TRACKS = {
  DIRECT_INVITE_7A: '7 A* Direct Invite Scholarship',
  EXCELLENCE_6A: '6 A* Excellence Scholarship',
  MERIT_DIAGNOSTIC: 'ALMA Merit Scholarship',
};

export const store = () => getStore({ name: 'alma-diagnostic', consistency: 'strong' });
export const uploads = () => getStore({ name: 'alma-uploads', consistency: 'strong' });

function secret() {
  const s = process.env.PASS_SIGNING_SECRET;
  if (!s || s.length < 16) throw new Error('PASS_SIGNING_SECRET is not set');
  return s;
}

const mac = (purpose, id) =>
  createHmac('sha256', secret()).update(`${purpose}:${id}`).digest('base64url').slice(0, 32);

export const newId = () => randomBytes(9).toString('base64url');

// Pass token: r_<id>.<hmac>. The id is random, so tickets can't be guessed in sequence.
export const passToken = id => `r_${id}.${mac('pass', id)}`;
// Separate signature for the admissions-only link to the uploaded results file.
export const fileToken = id => `f_${id}.${mac('file', id)}`;

export function verify(token, prefix, purpose) {
  const m = new RegExp(`^${prefix}_([A-Za-z0-9_-]{6,40})\\.([A-Za-z0-9_-]{32})$`).exec(token || '');
  if (!m) return null;
  const a = Buffer.from(m[2]);
  const b = Buffer.from(mac(purpose, m[1]));
  return a.length === b.length && timingSafeEqual(a, b) ? m[1] : null;
}

export const passUrl = id => `${SITE}/alma/pass/${passToken(id)}`;

export const qrDataUrl = text =>
  QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 360, color: { dark: '#2B1A1C', light: '#FFFFFF' } });

export const qrPng = text =>
  QRCode.toBuffer(text, { errorCorrectionLevel: 'M', margin: 1, width: 360, color: { dark: '#2B1A1C', light: '#FFFFFF' } });

// The public view of a registration: everything the ticket shows, nothing else
// (no phone numbers, guardian details or uploaded file).
export async function ticketView(rec) {
  const url = passUrl(rec.id);
  return {
    ref: rec.ref,
    seat: rec.seat,
    studentName: rec.studentName,
    age: rec.age,
    centerCode: rec.examCenter,
    center: CENTERS[rec.examCenter],
    applyingForScholarship: rec.applyingForScholarship,
    scholarshipTrack: rec.scholarshipTrack || '',
    track: TRACKS[rec.scholarshipTrack] || '',
    healthcarePledge: rec.healthcarePledge,
    event: EVENT,
    passUrl: url,
    qr: await qrDataUrl(url),
    createdAt: rec.createdAt,
  };
}

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
