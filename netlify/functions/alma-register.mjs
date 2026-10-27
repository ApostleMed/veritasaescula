// POST /api/alma/register
// Registers a student for the free ALMA Diagnostic & Scholarship Exam, assigns a
// reference and seat per exam centre, emails the QR ticket through Brevo and
// copies the row to the admissions Google Sheet.
import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import {
  CENTERS, TRACKS, EVENT, SITE, store, uploads, newId, passUrl, fileToken,
  qrPng, ticketView, json,
} from '../lib/alma.mjs';

export const config = { path: '/api/alma/register' };

// The same Apps Script web app that apply.html posts to (already public in form-config.js).
const SHEET_ENDPOINT = process.env.SHEET_ENDPOINT ||
  'https://script.google.com/macros/s/AKfycbwMx_mGOmMTbbn2B3EPl6HJUNQmJntdeN5S5fn3WmKQtq14kxD-WbVj1xIACx4St8xVvQ/exec';

const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE = 5.5 * 1024 * 1024;     // Netlify functions accept about 6 MB per request
const PHONE = /^\+?[0-9][0-9\s-]{6,17}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const text = (v, max = 120) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const on = v => v === 'on' || v === 'true' || v === '1';

export default async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let form;
  try { form = await req.formData(); } catch { return json({ error: 'The form could not be read. Please try again.' }, 400); }
  if (form.get('company')) return json({ error: 'Rejected' }, 400);       // spam trap

  const r = {
    studentName: text(form.get('studentName'), 80),
    age: Number(form.get('age')),
    studentPhone: text(form.get('studentPhone'), 24),
    studentEmail: text(form.get('studentEmail'), 120).toLowerCase(),
    guardianName: text(form.get('guardianName'), 80),
    guardianPhone: text(form.get('guardianPhone'), 24),
    examCenter: text(form.get('examCenter'), 3).toUpperCase(),
    applyingForScholarship: on(form.get('applyingForScholarship')),
    scholarshipTrack: text(form.get('scholarshipTrack'), 24),
    healthcarePledge: on(form.get('healthcarePledge')),
  };
  if (!r.applyingForScholarship) { r.scholarshipTrack = ''; r.healthcarePledge = false; }
  const file = form.get('scoreImage');

  const errors = {};
  if (r.studentName.length < 2) errors.studentName = 'Enter the student’s full name.';
  if (!Number.isInteger(r.age) || r.age < 12 || r.age > 25) errors.age = 'Age must be between 12 and 25.';
  if (!PHONE.test(r.studentPhone)) errors.studentPhone = 'Enter a valid phone number, e.g. +95 9 7976 13726.';
  if (!EMAIL.test(r.studentEmail)) errors.studentEmail = 'Enter a valid email address.';
  if (r.guardianName.length < 2) errors.guardianName = 'Enter the guardian’s full name.';
  if (!PHONE.test(r.guardianPhone)) errors.guardianPhone = 'Enter a valid phone number.';
  if (!CENTERS[r.examCenter]) errors.examCenter = 'Choose an exam centre.';
  if (r.applyingForScholarship && !TRACKS[r.scholarshipTrack]) errors.scholarshipTrack = 'Choose a scholarship pathway.';
  if (r.applyingForScholarship && !r.healthcarePledge) errors.healthcarePledge = 'The pledge is required for scholarship applicants.';
  if (!file || typeof file === 'string' || !file.size) errors.scoreImage = 'Upload your results or predicted grades.';
  else if (!FILE_TYPES.includes(file.type)) errors.scoreImage = 'Upload a JPG, PNG, WebP or PDF file.';
  else if (file.size > MAX_FILE) errors.scoreImage = 'The file is too large. Upload a file under 5 MB.';
  if (Object.keys(errors).length) return json({ error: 'Please check the highlighted fields.', errors }, 422);

  const db = store();

  // One ticket per email address: a second submission returns the existing ticket.
  const emailKey = `email/${createHash('sha256').update(r.studentEmail).digest('hex')}`;
  const existingId = await db.get(emailKey);
  if (existingId) {
    const old = await db.get(`reg/${existingId}`, { type: 'json' });
    if (old) return json({ existing: true, ticket: await ticketView(old) });
  }

  const n = await nextNumber(db, r.examCenter);
  const id = newId();
  const rec = {
    id,
    ...r,
    ref: `VAI-ALMA-2026-${r.examCenter}-${String(n).padStart(4, '0')}`,
    seat: `${r.examCenter}-${String(n).padStart(3, '0')}`,
    file: { name: text(file.name, 120), type: file.type, size: file.size },
    createdAt: new Date().toISOString(),
  };

  await uploads().set(id, await file.arrayBuffer(), { metadata: rec.file });
  await db.setJSON(`reg/${id}`, rec);
  await db.set(`ref/${rec.ref}`, id);
  await db.set(emailKey, id);

  // The registration is saved. Email or Sheet problems must not fail it.
  const [emailed] = await Promise.all([
    sendTicket(rec).then(() => true, err => { console.error('Ticket email failed:', err); return false; }),
    copyToSheet(rec).catch(err => console.error('Sheet copy failed:', err)),
  ]);
  if (!emailed) await db.setJSON(`reg/${id}`, { ...rec, emailFailed: true });

  return json({ ticket: await ticketView(rec), emailed });
};

// Next sequential number for a centre. Conditional writes keep two students
// who register at the same moment from getting the same seat.
async function nextNumber(db, center) {
  const key = `counter/${center}`;
  for (let attempt = 0; attempt < 12; attempt++) {
    const cur = await db.getWithMetadata(key, { type: 'json' });
    const next = (cur?.data?.n || 0) + 1;
    const res = cur
      ? await db.setJSON(key, { n: next }, { onlyIfMatch: cur.etag })
      : await db.setJSON(key, { n: next }, { onlyIfNew: true });
    if (res.modified) return next;
    await new Promise(ok => setTimeout(ok, 40 + Math.random() * 120));
  }
  throw new Error('Could not assign a seat number');
}

async function sendTicket(rec) {
  const { BREVO_KEY, BREVO_SMTP_LOGIN, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME, BREVO_BCC_EMAIL } = process.env;
  if (!BREVO_KEY || !BREVO_SMTP_LOGIN || !BREVO_SENDER_EMAIL) throw new Error('Brevo is not configured');

  const transport = nodemailer.createTransport({
    host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
    port: Number(process.env.BREVO_SMTP_PORT || 587),
    secure: false,
    auth: { user: BREVO_SMTP_LOGIN, pass: BREVO_KEY },
  });
  const url = passUrl(rec.id);
  await transport.sendMail({
    from: { name: BREVO_SENDER_NAME || 'Veritas Aescula Institute (VAI)', address: BREVO_SENDER_EMAIL },
    to: { name: rec.studentName, address: rec.studentEmail },
    bcc: BREVO_BCC_EMAIL || undefined,
    replyTo: 'aescula.meg@gmail.com',
    subject: `Your ALMA Diagnostic Exam ticket · ${rec.ref}`,
    text: emailText(rec, url),
    html: emailHtml(rec, url),
    attachments: [{ filename: `${rec.ref}-qr.png`, content: await qrPng(url), cid: 'ticketqr' }],
  });
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function examLine(rec) {
  return rec.scholarshipTrack === 'DIRECT_INVITE_7A'
    ? 'Direct Invite Candidate: pre-event online interview + stage awarding ceremony (exempt from the written exam)'
    : `${EVENT.exam} (1.5 hours · O Level + advanced MCQ & MSQ written paper)`;
}

function emailText(rec, url) {
  return [
    `Dear ${rec.studentName},`,
    '',
    'You are registered for the ALMA National Diagnostic & Scholarship Exam. Keep this email: show the QR code at check-in.',
    '',
    `Reference: ${rec.ref}`,
    `Centre: ${CENTERS[rec.examCenter]} · Seat ${rec.seat}`,
    `Date: ${EVENT.date}`,
    `Event: ${EVENT.time} (arrive by 1:00 PM MMT for check-in)`,
    `Exam: ${examLine(rec)}`,
    rec.applyingForScholarship ? `Scholarship: ${TRACKS[rec.scholarshipTrack]} · Healthcare & Medical Pledge confirmed` : '',
    '',
    `View or download your ticket: ${url}`,
    '',
    'Questions? Reply to this email or message us on Viber: +959797613726',
    'Veritas Aescula Institute',
  ].filter(l => l !== '').join('\n');
}

export function emailHtml(rec, url) {
  const row = (k, v) => `<tr><td style="padding:6px 0;color:#7D242B;font:700 11px/1.4 Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;width:120px;vertical-align:top">${k}</td><td style="padding:6px 0;color:#2B1A1C;font:600 15px/1.45 Arial,sans-serif">${v}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;background:#F7F1E8;padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:2px solid #C8A75E;border-radius:16px;overflow:hidden">
<tr><td style="background:#4A1419;padding:20px 24px">
  <img src="${SITE}/logo.png" width="48" height="48" alt="VAI" style="vertical-align:middle;border-radius:50%;background:#F7F1E8">
  <span style="margin-left:12px;color:#F7F1E8;font:700 18px Georgia,serif;vertical-align:middle">VAI · ALMA Admission Pass</span>
</td></tr>
<tr><td style="padding:24px">
  <p style="margin:0 0 4px;color:#C8A75E;font:700 11px Arial,sans-serif;letter-spacing:.12em">NATIONAL DIAGNOSTIC &amp; SCHOLARSHIP EXAM · 100% FREE</p>
  <h1 style="margin:0 0 4px;color:#4A1419;font:700 24px Georgia,serif">${esc(rec.studentName)}</h1>
  <p style="margin:0 0 16px;color:#5B4648;font:15px Arial,sans-serif">Age ${rec.age} · <strong>${rec.ref}</strong></p>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
    ${row('Centre', `${esc(CENTERS[rec.examCenter])} · Seat ${rec.seat}`)}
    ${row('Date', EVENT.date)}
    ${row('Event', `${EVENT.time}<br><span style="font-weight:400;color:#5B4648">Arrive by 1:00 PM MMT for check-in</span>`)}
    ${row('Exam', esc(examLine(rec)))}
    ${rec.applyingForScholarship ? row('Scholarship', `${esc(TRACKS[rec.scholarshipTrack])}<br><span style="font-weight:400;color:#5B4648">Healthcare &amp; Medical Pledge confirmed</span>`) : ''}
  </table>
  <div style="text-align:center;margin:20px 0 8px"><img src="cid:ticketqr" width="200" height="200" alt="QR code for ${rec.ref}" style="border:1px solid #D7CAB7;border-radius:8px"></div>
  <p style="margin:0 0 20px;text-align:center;color:#5B4648;font:13px Arial,sans-serif">Show this QR code at the check-in desk${rec.examCenter === 'ONL' ? ' (online candidates: keep it for your joining instructions)' : ''}.</p>
  <p style="text-align:center;margin:0"><a href="${url}" style="display:inline-block;background:#C8A75E;color:#4A1419;font:700 15px Arial,sans-serif;text-decoration:none;padding:12px 24px;border-radius:999px">View, download or print your ticket</a></p>
</td></tr>
<tr><td style="background:#F7F1E8;padding:16px 24px;color:#5B4648;font:12px/1.6 Arial,sans-serif">Bring this pass and photo ID matching the name above. Questions? Reply to this email or message us on Viber: +959797613726.<br>Veritas Aescula Institute · <a href="${SITE}/alma" style="color:#7D242B">veritasaescula.com/alma</a></td></tr>
</table></body></html>`;
}

async function copyToSheet(rec) {
  const p = new URLSearchParams({
    application_type: 'alma',
    full_name: rec.studentName,
    email: rec.studentEmail,
    reference: rec.ref,
    seat: rec.seat,
    exam_center: CENTERS[rec.examCenter],
    age: String(rec.age),
    phone: rec.studentPhone,
    guardian_name: rec.guardianName,
    guardian_contact: rec.guardianPhone,
    scholarship: rec.applyingForScholarship ? 'Yes' : 'No',
    scholarship_track: TRACKS[rec.scholarshipTrack] || '',
    healthcare_pledge: rec.healthcarePledge ? 'Yes' : 'No',
    results_file: `${SITE}/api/alma/file?t=${fileToken(rec.id)}`,
    pass_url: passUrl(rec.id),
  });
  const res = await fetch(SHEET_ENDPOINT, { method: 'POST', body: p, redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet responded ${res.status}`);
}
