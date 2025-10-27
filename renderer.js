document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('google')
    if (btn && window.electronAPI && typeof window.electronAPI.startGoogleLogin === 'function') {
        btn.addEventListener('click', () => {
            window.electronAPI.startGoogleLogin()
        })
    }

    const emailContainer = document.getElementById('email-display');
    if (emailContainer) {
        emailContainer.textContent = 'Sign in to load your inbox.';
        emailContainer.style.textAlign = 'center';
    }
})

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
            emailContainer.textContent = 'Fetching your inbox and generating AI summaries...';
        }
    });
}


if (window.electronAPI && typeof window.electronAPI.onSummariesLoading === 'function') {
    window.electronAPI.onSummariesLoading((payload) => {
        const { loading, hasSummaries } = payload || {};
        const container = document.getElementById('email-display');
        if (!container) return;

        if (loading) {
            container.innerHTML = '';
            const indicator = document.createElement('div');
            indicator.id = 'summary-loading-indicator';
            indicator.className = 'summary-loading-indicator';
            indicator.textContent = hasSummaries ? 'Generating summaries...' : 'Loading your inbox...';
            container.appendChild(indicator);
            return;
        }

        const existingIndicator = document.getElementById('summary-loading-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
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

            if (email && email.aiSummary) {
                const summary = document.createElement('div');
                summary.className = 'email-ai-summary';
                summary.textContent = email.aiSummary;
                item.appendChild(summary);
            }

            list.appendChild(item);
        });

        container.appendChild(list);
        // testCall();
    });
}

console.log('renderer.js');