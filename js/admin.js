
// Utility for selecting elements
const $ = (selector) => document.querySelector(selector);

const state = {
  mode: 'login',
  user: null,
  activeSession: null,
};

function showMessage(el, text, isError = false) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', isError);
}

async function fetchJson(url, options = {}) {
  const opts = {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  };
  if (opts.body && typeof opts.body === 'object') {
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error || res.statusText || 'Request failed';
    throw new Error(err);
  }
  return json;
}

function setMode(mode) {
  state.mode = mode;
  const title = $('#auth-title');
  const submit = $('#auth-submit');
  const toggleText = $('#auth-toggle-text');
  const toggleBtn = $('#auth-toggle-btn');
  if (!title || !submit || !toggleText || !toggleBtn) return;
  if (mode === 'register') {
    title.textContent = 'Register Admin';
    submit.textContent = 'Register';
    toggleText.textContent = 'Already have an account?';
    toggleBtn.textContent = 'Login';
  } else {
    title.textContent = 'Admin Login';
    submit.textContent = 'Login';
    toggleText.textContent = 'Need an account?';
    toggleBtn.textContent = 'Register';
  }
}

function showDashboard(user) {
  state.user = user;
  $('#auth').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');
  $('#dashboard-user').textContent = `Signed in as ${user.username}`;
  loadSessions();
}

function showAuth() {
  $('#dashboard').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  $('#auth-msg').textContent = '';
  setMode('login');
}

async function checkAuth() {
  try {
    const me = await fetchJson('/admin/me');
    if (me.authenticated) {
      showDashboard({ username: me.username });
    } else {
      showAuth();
    }
  } catch (err) {
    showAuth();
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const username = $('#username').value.trim();
  const password = $('#password').value;
  const msgEl = $('#auth-msg');
  showMessage(msgEl, '');
  if (!username || !password) {
    showMessage(msgEl, 'Please fill in both fields.', true);
    return;
  }
  const url = state.mode === 'register' ? '/admin/register' : '/admin/login';
  try {
    await fetchJson(url, { method: 'POST', body: { username, password } });
    showDashboard({ username });
  } catch (err) {
    showMessage(msgEl, err.message, true);
  }
}

async function loadSessions() {
  const container = $('#sessions-list');
  if (!container) return;
  try {
    const sessionsData = await fetchJson('/admin/sessions');
    let sessions = Array.isArray(sessionsData.sessions) ? sessionsData.sessions : [];
    // Sort sessions by createdAt descending
    sessions = sessions.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (sessions.length === 0) {
      container.innerHTML = '<div class="recent-empty">No sessions yet.</div>';
      return;
    }
    container.innerHTML = sessions
      .map((s) => {
        const created = new Date(s.createdAt).toLocaleString();
        return `
          <div class="recent-item" data-code="${s.code}" data-sessionid="${s.sessionId}">
            <div class="recent-meta">
              <div class="recent-code">${s.code}</div>
              <div class="recent-time">${created}</div>
            </div>
            <div class="recent-actions">
              <button class="btn btn-compact" data-action="open" type="button">Open</button>
              <button class="btn btn-compact" data-action="delete" type="button">Delete</button>
            </div>
          </div>
        `;
      })
      .join('');
  } catch (err) {
    container.innerHTML = `<div class="helper error">${err.message}</div>`;
  }
}

async function createSession() {
  try {
    if (window._adminLastQrOpened) {
      alert('QR code for the last session is no longer accessible. Please create a new session.');
      return;
    }
    const sessionData = await fetchJson('/create-session', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    await loadSessions();
    // Open QR code in a new tab (one-time only)
    if (sessionData && sessionData.qrCode && sessionData.sessionId) {
      const qrWindow = window.open('', '_blank');
      if (qrWindow) {
        qrWindow.document.write(`
          <html><head><title>Session QR Code</title></head><body style="background:#101820;color:#fff;text-align:center;font-family:sans-serif;">
            <h2 style="color:#00ffff;margin-top:2rem;">Session Created</h2>
            <img src="${sessionData.qrCode}" alt="QR Code" style="max-width:260px;width:100%;background:#fff;padding:8px;border-radius:12px;box-shadow:0 2px 12px #000;" />
            <div style="margin:1.2rem 0 0.5rem 0;font-size:1.1rem;color:#fff;">Session Code: <b style="color:#00ffff;">${sessionData.code}</b></div>
            <div style="margin-bottom:1.2rem;font-size:1rem;">Upload link: <a href="upload.html?session=${sessionData.sessionId}" target="_blank" style="color:#00ffff;text-decoration:underline;">Open Upload Page</a></div>
            <div style="margin-top:2rem;color:#ff8888;font-size:0.95rem;">This QR code will not be accessible again after closing this tab.</div>
          </body></html>
        `);
        qrWindow.document.close();
        window._adminLastQrOpened = true;
        const timer = setInterval(() => {
          if (qrWindow.closed) {
            clearInterval(timer);
            window._adminLastQrOpened = false;
          }
        }, 500);
      } else {
        alert('Popup blocked! Please allow popups for this site to view the QR code.');
      }
    }
  } catch (err) {
    alert('Could not create session: ' + err.message);
  }
}

async function deleteSession(code) {
  if (!confirm('Delete session and all uploaded files?')) return;
  try {
    await fetchJson(`/admin/session/${encodeURIComponent(code)}`, { method: 'DELETE' });
    await loadSessions();
    closeUploadsPanel();
  } catch (err) {
    alert('Failed to delete session: ' + err.message);
  }
}

function closeUploadsPanel() {
  const panel = $('#uploads-panel');
  if (!panel) return;
  panel.classList.add('hidden');
  panel.dataset.sessionId = '';
  panel.querySelector('#uploads-list').innerHTML = '';
  state.activeSession = null;
}

async function loadUploadsForSession(sessionId) {
  const panel = $('#uploads-panel');
  if (!panel) return;
  panel.classList.remove('hidden');
  panel.dataset.sessionId = sessionId;
  const list = $('#uploads-list');
  list.innerHTML = '<div class="recent-empty">Loading uploads...</div>';
  try {
    const uploadsData = await fetchJson(`/admin/session/${encodeURIComponent(sessionId)}/uploads`, { method: 'POST' });
    const uploads = Array.isArray(uploadsData.uploads) ? uploadsData.uploads : [];
    if (uploads.length === 0) {
      list.innerHTML = '<div class="recent-empty">No uploads for this session.</div>';
      return;
    }
    list.innerHTML = uploads
      .map((u) => {
        const time = u.uploadTime ? new Date(u.uploadTime).toLocaleString() : '';
        const safeName = u.originalName || u.filename || '';
        const downloadUrl = `/download/${encodeURIComponent(sessionId)}/${encodeURIComponent(u.filename)}`;
        return `
          <div class="file-item" style="display:flex; align-items:center; justify-content:space-between; gap:0.75rem;">
            <div style="flex:1; min-width:0;">
              <div><strong>${safeName}</strong></div>
              <div class="helper">${u.uploader || 'Unknown'} ${u.rollNumber ? `| ${u.rollNumber}` : ''}</div>
              <div class="helper">${time}</div>
            </div>
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
              <a class="btn btn-compact" href="${downloadUrl}" target="_blank" rel="noreferrer">Download</a>
              <button class="btn btn-compact" data-action="delete-file" data-filename="${u.filename}" type="button">Delete</button>
            </div>
          </div>
        `;
      })
      .join('');
  } catch (err) {
    list.innerHTML = `<div class="helper error">${err.message}</div>`;
  }
}

async function handleSessionsClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const action = btn.dataset.action;
  const container = btn.closest('.recent-item');
  if (!container) return;
  const code = container.dataset.code;
  const sessionId = container.dataset.sessionid;
  if (action === 'open') {
    window.open(`view.html?session=${encodeURIComponent(sessionId)}`, '_blank');
    return;
  }
  if (action === 'delete') {
    await deleteSession(code);
    return;
  }
}

async function handleUploadsClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.action !== 'delete-file') return;
  const filename = btn.dataset.filename;
  const sessionId = $('#uploads-panel')?.dataset?.sessionId;
  if (!sessionId || !filename) return;
  if (!confirm('Delete this file?')) return;
  try {
    await fetchJson(`/admin/file/${encodeURIComponent(sessionId)}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    await loadUploadsForSession(sessionId);
  } catch (err) {
    alert('Failed to delete file: ' + err.message);
  }
}

async function logout() {
  await fetchJson('/admin/logout', { method: 'POST' });
  showAuth();
}

function init() {
  const authForm = $('#auth-form');
  const toggleBtn = $('#auth-toggle-btn');
  const createBtn = $('#btn-create-session');
  const logoutBtn = $('#btn-logout');
  const sessionsList = $('#sessions-list');
  const closeUploadsBtn = $('#close-uploads');
  if (authForm) authForm.addEventListener('submit', handleAuthSubmit);
  if (toggleBtn) toggleBtn.addEventListener('click', () => {
    setMode(state.mode === 'login' ? 'register' : 'login');
    showMessage($('#auth-msg'), '');
  });
  if (createBtn) createBtn.addEventListener('click', createSession);
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
  if (sessionsList) sessionsList.addEventListener('click', handleSessionsClick);
  if (closeUploadsBtn) closeUploadsBtn.addEventListener('click', closeUploadsPanel);
  if ($('#uploads-list')) $('#uploads-list').addEventListener('click', handleUploadsClick);
  checkAuth();
}

window.addEventListener('DOMContentLoaded', init);
    showMessage($('#auth-msg'), '');
