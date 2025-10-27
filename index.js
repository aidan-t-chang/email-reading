const { app, BrowserWindow, screen, shell, ipcMain } = require('electron')
const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const { OAuth2Client } = require('google-auth-library');
const OpenAI = require('openai');


const REDIRECT_PROTOCOL = 'emailreader';
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'openid',
    'profile',
    'email',
];
let createWindow;

const oauthConfigPath = path.join(__dirname, 'oauth.config.json');
const openaiConfigPath = path.join(__dirname, 'openaiconfig.json');
let CLIENT_ID;
let CLIENT_SECRET;
let OPENAI_API_KEY;

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

OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
if (!OPENAI_API_KEY) {
    try {
        const rawOpenAIConfig = fs.readFileSync(openaiConfigPath, 'utf-8');
        const parsedOpenAIConfig = JSON.parse(rawOpenAIConfig);
        OPENAI_API_KEY = parsedOpenAIConfig.API_KEY || parsedOpenAIConfig.apiKey || null;
        if (!OPENAI_API_KEY) {
            throw new Error('Missing API_KEY property');
        }
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            console.warn('[OpenAI] API key not available; AI summaries disabled.');
        } else {
            console.error('[OpenAI] Failed to load API key from openaiconfig.json.', err);
        }
    }
}

let openai = null;
if (OPENAI_API_KEY) {
    try {
        openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    } catch (err) {
        console.error('[OpenAI] Failed to initialize client.', err);
    }
}


function decodeBase64Url(input) {
    if (!input) return '';
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function stripHtmlTags(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractPlainTextFromPayload(payload) {
    if (!payload) return '';

    if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
        return decodeBase64Url(payload.body.data).trim();
    }

    if (payload.mimeType === 'text/html' && payload.body && payload.body.data) {
        return stripHtmlTags(decodeBase64Url(payload.body.data));
    }

    if (payload.body && payload.body.data) {
        return decodeBase64Url(payload.body.data).trim();
    }

    if (Array.isArray(payload.parts)) {
        for (const part of payload.parts) {
            const text = extractPlainTextFromPayload(part);
            if (text) return text;
        }
    }

    return '';
}

function parseGmailMessage(message) {
    if (!message || !message.payload) return null;

    const headers = message.payload.headers || [];
    const findHeader = (name) => {
        const header = headers.find((h) => h.name && h.name.toLowerCase() === name.toLowerCase());
        return header ? header.value : '';
    };

    const bodyText = extractPlainTextFromPayload(message.payload) || message.snippet || '';

    return {
        id: message.id,
        subject: findHeader('Subject') || '(No subject)',
        from: findHeader('From') || '',
        date: findHeader('Date') || '',
        snippet: message.snippet || '',
        body: bodyText.trim(),
    };
}

async function fetchInboxMessages(oauth2Client, count = 10) {
    try {
        const listResponse = await oauth2Client.request({
            url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
            params: {
                maxResults: count,
                labelIds: ['INBOX'],
            },
        });

        const messages = listResponse.data && listResponse.data.messages;
        if (!messages || messages.length === 0) {
            console.log('No recent messages found in inbox.');
            return [];
        }

        const results = [];
        for (const metadata of messages) {
            if (!metadata || !metadata.id) continue;
            try {
                const messageResponse = await oauth2Client.request({
                    url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${metadata.id}`,
                    params: {
                        format: 'full',
                    },
                });
                const parsed = parseGmailMessage(messageResponse.data);
                if (!parsed) continue;
                const summarySource = parsed.body || parsed.snippet;
                if (openai && summarySource) {
                    try {
                        const aiSummary = await openai.responses.create({
                            model: 'gpt-4.1-mini',
                            input: `Summarize this email in one sentence and respond with any important times and dates in the format (date, time). 
                            If there are no important dates, do not respond with anything but still provide a summary. \n\n${summarySource}`,
                        });
                        const summaryText = (aiSummary?.output_text || '').trim();
                        if (summaryText) {
                            console.log(summaryText);
                            parsed.aiSummary = summaryText;
                        }
                    } catch (e) {
                        console.error('Failed to generate AI summary:', e);
                    }
                }
                results.push(parsed);
            } catch (messageError) {
                console.error(`Failed to fetch message ${metadata.id}:`, messageError);
            }
        }

        return results;
    } catch (error) {
        console.error('Failed to fetch Gmail messages:', error);
        return [];
    }
}


async function startGoogleLogin() {
    let oauth2Client;
    let serverPort = null;
    const server = http.createServer(async (req, res) => {
        try {
            console.log('OAuth callback received. req.url=', req.url, 'host=', req.headers.host);
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
                    oauth2Client.setCredentials(tokens);
                    let profilePayload = null;
                    if (tokens.id_token) {
                        const ticket = await oauth2Client.verifyIdToken({
                            idToken: tokens.id_token,
                            audience: CLIENT_ID,
                        });
                        profilePayload = ticket.getPayload(); // name, email, etc.
                        console.log('Logged in user name:', profilePayload && profilePayload.name);
                    } else {
                        console.warn('ID token missing from OAuth response; profile data unavailable.');
                    }
                    console.log('Login successful. Tokens:', tokens);

                    const win = BrowserWindow.getAllWindows()[0];
                    const sendToWindow = (channel, payload) => {
                        if (win && !win.isDestroyed()) {
                            win.webContents.send(channel, payload);
                        }
                    };

                    sendToWindow('auth-success', {
                        tokens,
                        profile: profilePayload,
                    });

                    const hasSummaries = Boolean(openai);
                    sendToWindow('summaries-loading', { loading: true, hasSummaries });

                    let inboxEmails = [];
                    try {
                        inboxEmails = await fetchInboxMessages(oauth2Client, 10);
                    } finally {
                        sendToWindow('inbox-emails', inboxEmails);
                        sendToWindow('summaries-loading', { loading: false, hasSummaries });
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

async function testCall() {
    try {
        const aiResponse = await openai.responses.create({
            model: 'gpt-4.1-mini',
            input: 'Who was the 33rd president of the United States?'
        })
        console.log('AI Response:', aiResponse.output_text);
    } catch (e) {
        console.error('Failed to generate AI response:', e);
    }
}
// testCall();

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
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
        app.quit()
    }
})

// IPC handlers: renderer -> main
ipcMain.on('start-google-login', () => {
    startGoogleLogin();
});

ipcMain.on('auth-redirect', (event, url) => {
    // Renderer can send a redirect URL string for the main process to handle
    if (typeof url === 'string') {
        handleGoogleAuthRedirect(url);
    }
});
