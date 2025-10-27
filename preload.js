const { contextBridge, ipcRenderer } = require('electron')

// Expose a minimal, safe API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  startGoogleLogin: () => ipcRenderer.send('start-google-login'),
  // For testing: let renderer pass a redirect URL string to main's handler
  triggerAuthRedirect: (url) => ipcRenderer.send('auth-redirect', url),
  // Allow renderer to listen for auth success messages from main
  onAuthSuccess: (callback) => ipcRenderer.on('auth-success', (event, data) => callback(data)),
  onInboxEmails: (callback) => ipcRenderer.on('inbox-emails', (event, emails) => callback(emails))
})
