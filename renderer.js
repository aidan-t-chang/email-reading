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
        status.style.fontSize = '25px';
        document.body.appendChild(status);
        }
    const displayName = profile && (profile.name || profile.email);
    status.textContent = displayName ? `Welcome, ${displayName}` : 'Signed in';
        console.log('Received tokens from main:', tokens);
        if (profile) {
        console.log('User profile:', profile);
        }
    });
}

console.log('renderer.js');