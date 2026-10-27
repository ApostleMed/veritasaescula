/* ALMA Admission Pass: renders the ticket (live preview or issued) and handles
   PNG download and printing. Used by alma.html and alma-pass.html. */
(function () {
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const EVENT = {
        date: '21 December 2026 (Tentative)',
        time: '1:00 PM – 4:00 PM MMT',
        exam: '1:30 PM – 3:00 PM MMT'
    };

    // t: { studentName, age, ref, seat, center, centerCode, applyingForScholarship,
    //      scholarshipTrack, track, healthcarePledge, qr, passUrl }
    function render(el, t, preview) {
        const direct = t.scholarshipTrack === 'DIRECT_INVITE_7A';
        const badges = [];
        if (direct) badges.push('<span class="vt-badge vt-badge--vip">Direct Invite Candidate · Pre-event online interview + VIP stage awarding ceremony</span>');
        if (t.applyingForScholarship && t.track) {
            badges.push(`<span class="vt-badge">${t.healthcarePledge ? 'Healthcare &amp; Medical Pledge Confirmed · ' : ''}${esc(t.track)}</span>`);
        }
        const exam = direct
            ? 'Exempt from the written exam<small>Online interview with the VAI Academic Team before the event</small>'
            : `${EVENT.exam}<small>1.5 hours · O Level + advanced MCQ &amp; MSQ written paper</small>`;
        const online = t.centerCode === 'ONL';
        const qr = t.qr
            ? `<img src="${t.qr}" alt="QR code for ${esc(t.ref)}" width="132" height="132">`
            : '<div class="vt-qr-empty">Your QR code appears here after you register</div>';

        el.innerHTML = `
        <article class="vt-ticket${preview ? ' is-preview' : ''}" aria-label="ALMA admission pass">
            <div class="vt-head">
                <img src="/logo.png" alt="Veritas Aescula Institute logo" width="44" height="44">
                <div><span>Veritas Aescula Institute</span><strong>VAI · ALMA Admission Pass</strong></div>
            </div>
            <div class="vt-body">
                <div class="vt-name">${esc(t.studentName)}</div>
                <div class="vt-sub">${t.age ? `Age ${esc(t.age)} · ` : ''}<span class="vt-ref">${esc(t.ref || 'VAI-ALMA-2026-' + (t.centerCode || '•••') + '-••••')}</span></div>
                ${badges.length ? `<div class="vt-badges">${badges.join('')}</div>` : ''}
                <dl class="vt-rows">
                    <div><dt>Centre</dt><dd>${esc(t.center || 'Choose a centre')}${t.seat ? ` · Seat ${esc(t.seat)}` : ''}</dd></div>
                    <div><dt>Date</dt><dd>${EVENT.date}</dd></div>
                    <div><dt>Event</dt><dd>${EVENT.time}<small>${online ? 'Joining instructions are emailed before the exam' : 'Arrive by 1:00 PM MMT for check-in'}</small></dd></div>
                    <div><dt>Exam</dt><dd>${exam}</dd></div>
                </dl>
            </div>
            <div class="vt-tear" aria-hidden="true"></div>
            <div class="vt-qr">
                ${qr}
                <p><strong>${online ? 'Keep this pass ready' : 'Show this at the door'}</strong>Bring this pass, on your phone or printed, and photo ID matching the name above.</p>
            </div>
        </article>`;
    }

    let h2c;
    function loadHtml2canvas() {
        if (window.html2canvas) return Promise.resolve(window.html2canvas);
        if (h2c) return h2c;
        h2c = new Promise((ok, fail) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
            s.onload = () => ok(window.html2canvas);
            s.onerror = () => { h2c = null; fail(new Error('Could not load the image tool')); };
            document.head.appendChild(s);
        });
        return h2c;
    }

    async function downloadPng(el, name) {
        const html2canvas = await loadHtml2canvas();
        const canvas = await html2canvas(el.querySelector('.vt-ticket'), { scale: 2, backgroundColor: null, useCORS: true });
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `${name || 'ALMA-ticket'}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    // Prints just the ticket; "Save as PDF" in the print dialog gives a PDF.
    function print(el) {
        const root = document.createElement('div');
        root.className = 'vt-print-root';
        root.innerHTML = el.innerHTML;
        document.body.appendChild(root);
        document.body.classList.add('vt-printing');
        const done = () => {
            document.body.classList.remove('vt-printing');
            root.remove();
            window.removeEventListener('afterprint', done);
        };
        window.addEventListener('afterprint', done);
        window.print();
        setTimeout(done, 1500);
    }

    function actions(container, el, t) {
        container.innerHTML = `
            <button type="button" class="vt-btn" data-vt="png">Download ticket (PNG)</button>
            <button type="button" class="vt-btn vt-btn--ghost" data-vt="print">Print / Save as PDF</button>`;
        container.querySelector('[data-vt="png"]').addEventListener('click', async e => {
            const b = e.currentTarget;
            b.disabled = true;
            try { await downloadPng(el, t.ref); } catch (err) { alert('The download did not work. Use Print / Save as PDF instead.'); }
            b.disabled = false;
        });
        container.querySelector('[data-vt="print"]').addEventListener('click', () => print(el));
    }

    window.VAITicket = { render, actions, downloadPng, print };
})();
