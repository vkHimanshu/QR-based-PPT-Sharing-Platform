document.addEventListener('DOMContentLoaded', () => {
    const navButtons = Array.from(document.querySelectorAll('.nav-btn'));
    const panels = Array.from(document.querySelectorAll('.panel'));
    const createBtn = document.getElementById('create-btn');
    const sessionInfo = document.getElementById('session-info');
    const qrCodeImg = document.getElementById('qr-code');
    const uploadLinkSpan = document.getElementById('upload-link');
    const viewBtn = document.getElementById('view-btn');
    const sessionCodeEl = document.getElementById('session-code');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const copyCodeMsg = document.getElementById('copy-code-msg');
    const recentList = document.getElementById('recent-list');
    const clearRecentBtn = document.getElementById('clear-recent-btn');
    const zoomOutBtn = document.getElementById('qr-zoom-out');
    const zoomInBtn = document.getElementById('qr-zoom-in');
    const zoomResetBtn = document.getElementById('qr-zoom-reset');

    const RECENT_KEY = 'qrps_recent_sessions_v1';
    let qrScale = 1;

    function setActivePanel(panelId) {
        panels.forEach(p => p.classList.toggle('is-active', p.id === panelId));
        navButtons.forEach(b => b.classList.toggle('is-active', b.getAttribute('data-panel') === panelId));
    }

    if (navButtons.length && panels.length) {
        navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const panelId = btn.getAttribute('data-panel');
                if (panelId) setActivePanel(panelId);
            });
        });
        // default
        setActivePanel('create-panel');
    }

    function applyQrScale() {
        if (!qrCodeImg) return;
        qrCodeImg.style.transform = `scale(${qrScale})`;
    }

    function loadRecent() {
        try {
            const raw = localStorage.getItem(RECENT_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    }

    function saveRecent(arr) {
        try {
            localStorage.setItem(RECENT_KEY, JSON.stringify(arr));
        } catch {
            // ignore storage errors
        }
    }

    function formatTime(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleString();
    }

    function renderRecent() {
        if (!recentList) return;
        const recents = loadRecent();
        if (recents.length === 0) {
            recentList.innerHTML = `<div class="recent-empty">No saved sessions yet.</div>`;
            return;
        }

        recentList.innerHTML = recents.map((s, idx) => {
            const safeCode = String(s.code || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeUrl = String(s.viewUrl || '');
            return `
                <div class="recent-item">
                    <div class="recent-meta">
                        <div class="recent-code">${safeCode}</div>
                        <div class="recent-time">${formatTime(s.createdAt)}</div>
                    </div>
                    <div class="recent-actions">
                        <button class="btn btn-compact" type="button" data-copy-code="${safeCode}">Copy code</button>
                        <a class="btn btn-compact" href="${safeUrl}" target="_blank" rel="noreferrer">Open</a>
                        <button class="btn btn-compact" type="button" data-remove-index="${idx}">Remove</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    async function copyText(text) {
        const t = String(text || '');
        if (!t) return false;
        try {
            await navigator.clipboard.writeText(t);
            return true;
        } catch {
            // Fallback for older browsers / insecure contexts
            const ta = document.createElement('textarea');
            ta.value = t;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try {
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                return ok;
            } catch {
                document.body.removeChild(ta);
                return false;
            }
        }
    }

    function setCopyMsg(text, isError = false) {
        if (!copyCodeMsg) return;
        copyCodeMsg.textContent = text;
        copyCodeMsg.classList.remove('hidden');
        copyCodeMsg.classList.toggle('error', isError);
        window.clearTimeout(setCopyMsg._t);
        setCopyMsg._t = window.setTimeout(() => copyCodeMsg.classList.add('hidden'), 1800);
    }

    // Initial render of saved sessions
    renderRecent();

    if (recentList) {
        recentList.addEventListener('click', async (e) => {
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;

            const code = target.getAttribute('data-copy-code');
            if (code) {
                const ok = await copyText(code);
                setCopyMsg(ok ? 'Copied code.' : 'Could not copy.', !ok);
                return;
            }

            const removeIndex = target.getAttribute('data-remove-index');
            if (removeIndex != null) {
                const idx = Number(removeIndex);
                const recents = loadRecent();
                if (Number.isInteger(idx) && idx >= 0 && idx < recents.length) {
                    recents.splice(idx, 1);
                    saveRecent(recents);
                    renderRecent();
                }
            }
        });
    }

    if (clearRecentBtn) {
        clearRecentBtn.addEventListener('click', () => {
            saveRecent([]);
            renderRecent();
        });
    }

    createBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/create-session');
            const data = await response.json();

            if (response.ok) {
                setActivePanel('create-panel');
                // Display QR code image
                qrCodeImg.src = data.qrCode;
                qrScale = 1;
                applyQrScale();

                // Show actual upload link, not base64
                uploadLinkSpan.innerHTML = `
                    <a href="upload.html?session=${data.sessionId}" target="_blank" style="color:#00ffff; text-decoration:underline;">
                        Open Upload Page
                    </a>
                `;

                // Set View Uploads button link
                viewBtn.href = data.viewUrl;

                sessionInfo.classList.remove('hidden');
                createBtn.style.display = 'none';

                // Show and persist the session code
                if (data.code && sessionCodeEl) {
                    sessionCodeEl.textContent = data.code;

                    const recents = loadRecent();
                    const entry = { code: data.code, viewUrl: data.viewUrl, createdAt: new Date().toISOString() };
                    const next = [entry, ...recents.filter(s => s && s.code !== data.code)].slice(0, 10);
                    saveRecent(next);
                    renderRecent();
                }

            } else {
                alert('Failed to create session: ' + data.error);
            }
        } catch (error) {
            alert('Server not activated. Please try again.');
            console.error(error);
        }
    });

    if (copyCodeBtn) {
        copyCodeBtn.addEventListener('click', async () => {
            const code = sessionCodeEl ? sessionCodeEl.textContent : '';
            const ok = await copyText(code);
            setCopyMsg(ok ? 'Copied session code.' : 'Could not copy.', !ok);
        });
    }

    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', () => {
            qrScale = Math.max(0.6, Math.round((qrScale - 0.2) * 10) / 10);
            applyQrScale();
        });
    }

    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => {
            qrScale = Math.min(2.5, Math.round((qrScale + 0.2) * 10) / 10);
            applyQrScale();
        });
    }

    if (zoomResetBtn) {
        zoomResetBtn.addEventListener('click', () => {
            qrScale = 1;
            applyQrScale();
        });
    }
});

 // 🔍 Session Code Search Feature
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('session-code-input');
    const btn = document.getElementById('search-btn');
    const msg = document.getElementById('search-msg');

    if (!input || !btn) return; // Skip if not on this page

    btn.addEventListener('click', () => {
        const code = (input.value || '').trim();
        if (!/^\d{4,5}$/.test(code)) {
            msg.textContent = '⚠️ Please enter a valid 4 or 5 digit code.';
            msg.classList.remove('hidden');
            return;
        }
        msg.classList.add('hidden');

        // Redirect to backend route which redirects to the view page
        window.location.href = `/session-code/${encodeURIComponent(code)}`;
    });

    // Pressing Enter key also works
    input.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') btn.click();
    });
});
