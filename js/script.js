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
            } else {
                alert('Failed to create session: ' + data.error);
            }
        } catch (error) {
            alert('Error creating session. Please try again.');
            console.error(error);
        }
    });
});
