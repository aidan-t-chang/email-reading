// Renderer script (loaded from file so CSP 'script-src \"self\"' is satisfied)
// Binds the Sign in button to the API exposed by preload.js

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('google')
    if (btn && window.electronAPI && typeof window.electronAPI.startGoogleLogin === 'function') {
        btn.addEventListener('click', () => {
            // Ask the main process to start the OAuth flow (opens browser)
            window.electronAPI.startGoogleLogin()
        })
    }

    const emailContainer = document.getElementById('email-display');
    if (emailContainer) {
        emailContainer.textContent = 'Sign in to load your inbox.';
    }

    // For testing only: call from devtools console to simulate redirect handling
    // window.electronAPI.triggerAuthRedirect('emailreader://callback?code=...')
})

// Listen for auth success and update the UI
if (window.electronAPI && typeof window.electronAPI.onAuthSuccess === 'function') {
    window.electronAPI.onAuthSuccess((data) => {
        const { tokens, profile } = data || {};
        // hide sign in button once auth succeeds
        const btn = document.getElementById('google');
        if (btn) {
            btn.style.display = 'none';
        }

        let status = document.getElementById('auth-status');
        if (!status) {
            status = document.createElement('p');
            status.id = 'auth-status';
            document.body.appendChild(status);
        }
        status.style.fontSize = '25px';
        status.style.marginTop = '20px';
        status.style.fontWeight = 'bold';

    const displayName = profile && (profile.name || profile.email);
    status.textContent = displayName ? `Welcome, ${displayName}` : 'Signed in';
        console.log('Received tokens from main:', tokens);
        if (profile) {
            console.log('User profile:', profile);
        }

        const emailContainer = document.getElementById('email-display');
        if (emailContainer) {
            emailContainer.textContent = 'Loading your inbox...';
        }
    });
}

if (window.electronAPI && typeof window.electronAPI.onInboxEmails === 'function') {
    window.electronAPI.onInboxEmails((emails) => {
        const container = document.getElementById('email-display');
        if (!container) return;

        container.innerHTML = '';

        if (!emails || emails.length === 0) {
            const emptyMessage = document.createElement('p');
            emptyMessage.textContent = 'No recent emails found.';
            container.appendChild(emptyMessage);
            return;
        }

        const list = document.createElement('ol');
        list.className = 'email-list';

        emails.forEach((email) => {
            const item = document.createElement('li');
            item.className = 'email-list-item';

            const subject = document.createElement('span');
            subject.className = 'email-subject';
            subject.textContent = email && email.subject ? email.subject : '(No subject)';
            item.appendChild(subject);

            if (email && email.from) {
                const fromLine = document.createElement('span');
                fromLine.className = 'email-from';
                fromLine.textContent = ` — ${email.from}`;
                item.appendChild(fromLine);
            }

            list.appendChild(item);
        });

        container.appendChild(list);
    });
}

console.log('renderer.js');