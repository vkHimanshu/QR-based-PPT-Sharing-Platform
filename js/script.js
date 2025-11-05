document.addEventListener('DOMContentLoaded', () => {
    const createBtn = document.getElementById('create-btn');
    const sessionInfo = document.getElementById('session-info');
    const qrCodeImg = document.getElementById('qr-code');
    const uploadLinkSpan = document.getElementById('upload-link');
    const viewBtn = document.getElementById('view-btn');

    createBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/create-session');
            const data = await response.json();

            if (response.ok) {
                // Display QR code image
                qrCodeImg.src = data.qrCode;

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
                 // ✅ Display the session code if available
                 if (data.code) {
                   const codeElement = document.createElement('p');
                   codeElement.style.marginTop = '1rem';
                    codeElement.style.fontWeight = 'bold';
                     codeElement.style.color = '#0ff';
                     codeElement.textContent = `Session Code: ${data.code}`;
                     sessionInfo.appendChild(codeElement);
                          }


            } else {
                alert('Failed to create session: ' + data.error);
            }
        } catch (error) {
            alert('Server not activated. Please try again.');
            console.error(error);
        }
    });
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
            msg.style.display = 'block';
            return;
        }
        msg.style.display = 'none';

        // Redirect to backend route which redirects to the view page
        window.location.href = `/session-code/${encodeURIComponent(code)}`;
    });

    // Pressing Enter key also works
    input.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') btn.click();
    });
});
