const { app, BrowserWindow, screen, shell, ipcMain } = require('electron')
const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const { OAuth2Client } = require('google-auth-library');


const REDIRECT_PROTOCOL = 'emailreader';
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'openid',
    'profile',
    'email',
];
let createWindow;

const oauthConfigPath = path.join(__dirname, 'oauth.config.json');
let CLIENT_ID;
let CLIENT_SECRET;

try {
    const rawConfig = fs.readFileSync(oauthConfigPath, 'utf-8');
    const parsedConfig = JSON.parse(rawConfig);
    CLIENT_ID = parsedConfig.clientId;
    CLIENT_SECRET = parsedConfig.clientSecret;

    if (!CLIENT_ID || !CLIENT_SECRET) {
        throw new Error('Missing clientId or clientSecret');
    }
} catch (err) {
    console.error('[OAuth] Failed to load desktop credentials from oauth.config.json.');
    console.error('Create oauth.config.json (see oauth.config.example.json) and paste the clientId/clientSecret from your Google Desktop OAuth client.');
    throw err;
}


async function startGoogleLogin() {
    // Create a temporary local HTTP server to receive the OAuth callback.
    let oauth2Client;
    let serverPort = null;
    const server = http.createServer(async (req, res) => {
        try {
            console.log('OAuth callback received. req.url=', req.url, 'host=', req.headers.host);
            // Use the captured serverPort (set when server.listen fires). Fallback to server.address().port
            const portToUse = serverPort || (server.address() && server.address().port);
            if (!portToUse) {
                console.error('Unable to determine server port for callback URL (server.address() is null)');
            }
            const reqUrl = new URL(req.url, `http://127.0.0.1:${portToUse}`);
            console.log('Parsed callback URL:', reqUrl.href);

            const pathname = reqUrl.pathname;


            const code = reqUrl.searchParams.get('code');
            const oauthError = reqUrl.searchParams.get('error');

            if (pathname === '/favicon.ico') {
                res.writeHead(204);
                res.end();
                return;
            }

            if (pathname !== '/callback') {
                console.warn(`Received request for unexpected path ${pathname}. Returning 404.`);
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found');
                return;
            }

            if (oauthError) {
                console.error('OAuth provider returned an error:', oauthError, 'full URL:', reqUrl.href);
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end('<html><body><h1>Authentication failed. You may close this window.</h1></body></html>');
                server.close();
                return;
            }

            if (!code) {
                console.warn('Callback received without a code parameter. Full URL:', reqUrl.href);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body><h1>Waiting for auth code...</h1></body></html>');
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Login success. You can close this window.</h1></body></html>');

            server.close();

            if (oauth2Client) {
                try {
                    const { tokens } = await oauth2Client.getToken(code);
                    let profilePayload = null;
                    if (tokens.id_token) {
                        const ticket = await oauth2Client.verifyIdToken({
                            idToken: tokens.id_token,
                            audience: CLIENT_ID,
                        });
                        profilePayload = ticket.getPayload(); // Contains name/email when profile/email scopes present
                        console.log('Logged in user name:', profilePayload && profilePayload.name);
                    } else {
                        console.warn('ID token missing from OAuth response; profile data unavailable.');
                    }
                    console.log('Login successful. Tokens:', tokens);
                    const win = BrowserWindow.getAllWindows()[0];
                    if (win) {
                        win.webContents.send('auth-success', {
                            tokens,
                            profile: profilePayload,
                        });
                    }
                } catch (error) {
                    console.error('Error exchanging code for tokens:', error);
                    if (error.response) {
                        console.error('Token endpoint response status:', error.response.status);
                        console.error('Token endpoint response data:', error.response.data);
                    }
                }
            }
        } catch (err) {
            console.error('Error handling OAuth callback:', err);
            try { 
                res.end(); 
            } catch(e) {}
            server.close();
        }
    });

    // find a random port on localhost
    server.on('error', (err) => {
        console.error('OAuth callback server error:', err);
    });

    server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address.port !== 'number') {
            console.error('Failed to bind local OAuth callback server to a port.');
            server.close();
            return;
        }
        const port = address.port;
        // capture the port for use inside the request handler (avoid server.address() being null)
        serverPort = port;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, redirectUri);
        const authURL = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES.join(' '),
            // prompt: 'consent' 
        });
        console.log(`OAuth server listening on ${redirectUri}`);
        console.log(`Opening browser to: ${authURL}`);
        shell.openExternal(authURL);
    });
}

async function handleGoogleAuthRedirect(url) {
    const urlObject = new URL(url);
    const code = urlObject.searchParams.get('code');

    if (code) {
        try {
            const redirectUri = `${REDIRECT_PROTOCOL}://callback`;
            const clientForProtocol = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, redirectUri);
            const { tokens } = await clientForProtocol.getToken(code);
            console.log('Login successful. Tokens:', tokens);

        } catch (error) {
            console.error('Error exchanging code for tokens:', error);
        }
    }
}

app.on('ready', () => {
    if (process.platform === 'win32') {
        app.setAsDefaultProtocolClient(REDIRECT_PROTOCOL);
    }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleGoogleAuthRedirect(url);
});

createWindow = () => {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize

    const win = new BrowserWindow({
        width: width,
        height: height,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    })

    win.loadFile('main.html')
    win.maximize();
}

app.whenReady().then(() => {
    createWindow()
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') app.quit()
})

// IPC handlers: renderer -> main
ipcMain.on('start-google-login', () => {
    startGoogleLogin();
});

ipcMain.on('auth-redirect', (event, url) => {
    // Renderer can send a redirect URL string for the main process to handle
    if (typeof url === 'string') handleGoogleAuthRedirect(url);
});
