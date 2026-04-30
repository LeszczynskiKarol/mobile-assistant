// Gmail REST API z OAuth2 — bez googleapis SDK (mniejszy bundle)
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Odśwież access token z refresh token
 */
async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google OAuth error: ${err}`);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedAccessToken;
}

function gmailFetch(path, opts = {}) {
  return getAccessToken().then(token =>
    fetch(`${GMAIL_API}${path}`, {
      method: opts.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      ...(opts.body && { body: JSON.stringify(opts.body) })
    }).then(async res => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gmail ${res.status}: ${text}`);
      }
      return res.json();
    })
  );
}

/**
 * Koduje email do formatu RFC 2822 base64url
 */
function encodeEmail({ to, subject, body, from }) {
  const email = [
    `From: ${from || process.env.GMAIL_FROM}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body
  ].join('\r\n');

  return Buffer.from(email)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Wyślij email
 */
export async function gmailSend({ to, subject, body }) {
  if (!to || !subject || !body) {
    throw new Error('Brakuje to, subject lub body');
  }

  const raw = encodeEmail({ to, subject, body });
  const result = await gmailFetch('/messages/send', {
    method: 'POST',
    body: { raw }
  });

  return { messageId: result.id, to, subject };
}

/**
 * Utwórz draft
 */
export async function gmailDraft({ to, subject, body }) {
  if (!to || !subject || !body) {
    throw new Error('Brakuje to, subject lub body');
  }

  const raw = encodeEmail({ to, subject, body });
  const result = await gmailFetch('/drafts', {
    method: 'POST',
    body: { message: { raw } }
  });

  return { draftId: result.id, to, subject };
}
