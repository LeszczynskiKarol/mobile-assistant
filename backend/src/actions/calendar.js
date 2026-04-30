// Google Calendar REST API — współdzieli OAuth2 z Gmail
const GCAL_API = 'https://www.googleapis.com/calendar/v3';

let cachedAccessToken = null;
let tokenExpiresAt = 0;

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
  if (!res.ok) throw new Error(`OAuth error: ${await res.text()}`);
  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedAccessToken;
}

function gcalFetch(path, opts = {}) {
  return getAccessToken().then(token => {
    const url = new URL(`${GCAL_API}${path}`);
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) url.searchParams.set(k, v);
    }
    return fetch(url.toString(), {
      method: opts.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      ...(opts.body && { body: JSON.stringify(opts.body) })
    }).then(async res => {
      if (!res.ok) throw new Error(`Calendar ${res.status}: ${await res.text()}`);
      return res.json();
    });
  });
}

/**
 * Utwórz wydarzenie
 */
export async function calendarCreate({ title, date, duration, description }) {
  const calendarId = process.env.GCAL_CALENDAR_ID || 'primary';
  const startDate = new Date(date);
  const endDate = new Date(startDate.getTime() + (duration || 60) * 60_000);

  const event = await gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: {
      summary: title,
      description: description || '',
      start: {
        dateTime: startDate.toISOString(),
        timeZone: 'Europe/Warsaw'
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: 'Europe/Warsaw'
      }
    }
  });

  return {
    id: event.id,
    title: event.summary,
    start: event.start.dateTime,
    link: event.htmlLink
  };
}

/**
 * Lista nadchodzących wydarzeń
 */
export async function calendarList({ days } = {}) {
  const calendarId = process.env.GCAL_CALENDAR_ID || 'primary';
  const now = new Date();
  const until = new Date(now.getTime() + (days || 7) * 86_400_000);

  const result = await gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    params: {
      timeMin: now.toISOString(),
      timeMax: until.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '20'
    }
  });

  return (result.items || []).map(e => ({
    title: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    location: e.location || null
  }));
}
