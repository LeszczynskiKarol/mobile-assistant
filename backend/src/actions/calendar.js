// Google Calendar REST API — kompletna integracja
// Współdzieli OAuth2 z Gmail/Drive/Contacts
const GCAL_API = "https://www.googleapis.com/calendar/v3";

async function getAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`OAuth error: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function gcalFetch(path, opts = {}) {
  const token = await getAccessToken();
  const url = new URL(`${GCAL_API}${path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const fetchOpts = {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (opts.body) fetchOpts.body = JSON.stringify(opts.body);

  const res = await fetch(url.toString(), fetchOpts);
  if (res.status === 204) return { success: true };
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Helpers ──

function parseEvent(e) {
  return {
    id: e.id,
    title: e.summary || "(bez tytułu)",
    description: e.description || null,
    location: e.location || null,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    allDay: !!e.start?.date,
    timeZone: e.start?.timeZone || null,
    status: e.status,
    htmlLink: e.htmlLink,
    creator: e.creator?.email || null,
    organizer: e.organizer?.email || null,
    attendees:
      e.attendees?.map((a) => ({
        email: a.email,
        name: a.displayName || null,
        status: a.responseStatus,
        organizer: a.organizer || false,
        self: a.self || false,
      })) || [],
    recurrence: e.recurrence || null,
    recurringEventId: e.recurringEventId || null,
    reminders: e.reminders || null,
    attachments:
      e.attachments?.map((a) => ({
        title: a.title,
        fileUrl: a.fileUrl,
        mimeType: a.mimeType,
      })) || [],
    conferenceData: e.conferenceData
      ? {
          type: e.conferenceData.conferenceSolution?.name,
          entryPoints: e.conferenceData.entryPoints?.map((ep) => ({
            type: ep.entryPointType,
            uri: ep.uri,
            label: ep.label,
          })),
        }
      : null,
    colorId: e.colorId || null,
  };
}

function buildEventBody({
  title,
  date,
  endDate,
  duration,
  description,
  location,
  attendees,
  recurrence,
  allDay,
  reminders,
  colorId,
  visibility,
  transparency,
  attachments,
}) {
  const body = {};
  if (title) body.summary = title;
  if (description !== undefined) body.description = description;
  if (location !== undefined) body.location = location;
  if (colorId) body.colorId = colorId;
  if (visibility) body.visibility = visibility;
  if (transparency) body.transparency = transparency;

  if (date) {
    if (allDay) {
      const d = new Date(date);
      body.start = { date: d.toISOString().split("T")[0] };
      const endD = endDate
        ? new Date(endDate)
        : new Date(d.getTime() + 86_400_000);
      body.end = { date: endD.toISOString().split("T")[0] };
    } else {
      const startDate = new Date(date);
      const end = endDate
        ? new Date(endDate)
        : new Date(startDate.getTime() + (duration || 60) * 60_000);
      body.start = {
        dateTime: startDate.toISOString(),
        timeZone: "Europe/Warsaw",
      };
      body.end = { dateTime: end.toISOString(), timeZone: "Europe/Warsaw" };
    }
  }

  if (attendees?.length) {
    body.attendees = attendees.map((a) =>
      typeof a === "string" ? { email: a } : a,
    );
  }
  if (recurrence?.length) body.recurrence = recurrence;
  if (reminders) {
    if (reminders === "none") {
      body.reminders = { useDefault: false, overrides: [] };
    } else if (Array.isArray(reminders)) {
      body.reminders = {
        useDefault: false,
        overrides: reminders.map((r) => ({
          method: r.method || "popup",
          minutes: r.minutes || 10,
        })),
      };
    }
  }
  if (attachments?.length) {
    body.attachments = attachments.map((a) => ({
      fileUrl: a.fileUrl || a.url,
      title: a.title || "Załącznik",
      mimeType: a.mimeType,
    }));
  }
  return body;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUBLIC ACTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 1. Utwórz wydarzenie w kalendarzu
 */
export async function calendarCreate({
  title,
  date,
  endDate,
  duration,
  description,
  location,
  attendees,
  recurrence,
  allDay,
  reminders,
  colorId,
  calendarId,
  attachments,
}) {
  if (!title) throw new Error("Brakuje title");
  if (!date) throw new Error("Brakuje date");
  const cid = calendarId || process.env.GCAL_CALENDAR_ID || "primary";
  const body = buildEventBody({
    title,
    date,
    endDate,
    duration,
    description,
    location,
    attendees,
    recurrence,
    allDay,
    reminders,
    colorId,
    attachments,
  });
  const params = {};
  if (attendees?.length) params.sendUpdates = "all";
  if (attachments?.length) params.supportsAttachments = "true";

  const event = await gcalFetch(
    `/calendars/${encodeURIComponent(cid)}/events`,
    {
      method: "POST",
      body,
      params,
    },
  );
  return parseEvent(event);
}

/**
 * 2. Lista nadchodzących wydarzeń
 */
export async function calendarList({
  days,
  maxResults,
  calendarId,
  query,
} = {}) {
  const cid = calendarId || process.env.GCAL_CALENDAR_ID || "primary";
  const now = new Date();
  const until = new Date(now.getTime() + (days || 7) * 86_400_000);

  const result = await gcalFetch(
    `/calendars/${encodeURIComponent(cid)}/events`,
    {
      params: {
        timeMin: now.toISOString(),
        timeMax: until.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: String(maxResults || 20),
        q: query || undefined,
      },
    },
  );
  return {
    events: (result.items || []).map(parseEvent),
    totalFound: result.items?.length || 0,
  };
}

/**
 * 3. Pobierz szczegóły wydarzenia
 */
export async function calendarGet({ eventId, calendarId }) {
  if (!eventId) throw new Error("Brakuje eventId");
  const cid = calendarId || process.env.GCAL_CALENDAR_ID || "primary";
  const event = await gcalFetch(
    `/calendars/${encodeURIComponent(cid)}/events/${encodeURIComponent(eventId)}`,
  );
  return parseEvent(event);
}

/**
 * 4. Edytuj wydarzenie (PATCH — partial update)
 */
export async function calendarUpdate({
  eventId,
  title,
  date,
  endDate,
  duration,
  description,
  location,
  attendees,
  recurrence,
  allDay,
  reminders,
  colorId,
  calendarId,
  visibility,
  transparency,
  attachments,
}) {
  if (!eventId) throw new Error("Brakuje eventId");
  const cid = calendarId || process.env.GCAL_CALENDAR_ID || "primary";
  const body = buildEventBody({
    title,
    date,
    endDate,
    duration,
    description,
    location,
    attendees,
    recurrence,
    allDay,
    reminders,
    colorId,
    visibility,
    transparency,
    attachments,
  });
  const params = {};
  if (attendees?.length) params.sendUpdates = "all";
  if (attachments?.length) params.supportsAttachments = "true";

  const event = await gcalFetch(
    `/calendars/${encodeURIComponent(cid)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body, params },
  );
  return parseEvent(event);
}

/**
 * 5. Usuń wydarzenie
 */
export async function calendarDelete({
  eventId,
  calendarId,
  notifyAttendees = true,
}) {
  if (!eventId) throw new Error("Brakuje eventId");
  const cid = calendarId || process.env.GCAL_CALENDAR_ID || "primary";
  await gcalFetch(
    `/calendars/${encodeURIComponent(cid)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      params: { sendUpdates: notifyAttendees ? "all" : "none" },
    },
  );
  return { eventId, deleted: true };
}

/**
 * 6. Wyszukaj wydarzenia po tekście
 */
export async function calendarSearch({ query, days, maxResults, calendarId }) {
  if (!query) throw new Error("Brakuje query");
  return calendarList({
    query,
    days: days || 30,
    maxResults: maxResults || 10,
    calendarId,
  });
}

/**
 * 7. Quick Add — natural language event creation
 */
export async function calendarQuickAdd({ text, calendarId }) {
  if (!text) throw new Error("Brakuje text");
  const cid = calendarId || process.env.GCAL_CALENDAR_ID || "primary";
  const event = await gcalFetch(
    `/calendars/${encodeURIComponent(cid)}/events/quickAdd`,
    { method: "POST", params: { text } },
  );
  return parseEvent(event);
}

/**
 * 8. Lista kalendarzy użytkownika
 */
export async function calendarCalendars({ maxResults } = {}) {
  const result = await gcalFetch("/users/me/calendarList", {
    params: { maxResults: String(maxResults || 20) },
  });
  return {
    calendars: (result.items || []).map((c) => ({
      id: c.id,
      name: c.summary,
      description: c.description || null,
      primary: c.primary || false,
      accessRole: c.accessRole,
      backgroundColor: c.backgroundColor,
      timeZone: c.timeZone,
    })),
  };
}

/**
 * 9. Przenieś wydarzenie do innego kalendarza
 */
export async function calendarMove({
  eventId,
  destinationCalendarId,
  calendarId,
}) {
  if (!eventId || !destinationCalendarId)
    throw new Error("Brakuje eventId lub destinationCalendarId");
  const cid = calendarId || process.env.GCAL_CALENDAR_ID || "primary";
  const event = await gcalFetch(
    `/calendars/${encodeURIComponent(cid)}/events/${encodeURIComponent(eventId)}/move`,
    { method: "POST", params: { destination: destinationCalendarId } },
  );
  return parseEvent(event);
}

/**
 * 10. Dodaj załącznik z Google Drive do wydarzenia
 */
export async function calendarAttach({ eventId, driveFileId, calendarId }) {
  if (!eventId || !driveFileId)
    throw new Error("Brakuje eventId lub driveFileId");
  const cid = calendarId || process.env.GCAL_CALENDAR_ID || "primary";

  // Pobierz metadane pliku z Drive
  const token = await getAccessToken();
  const fileRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=name,mimeType,webViewLink`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!fileRes.ok) throw new Error(`Drive file: ${fileRes.status}`);
  const file = await fileRes.json();

  // Pobierz istniejące attachments
  const current = await gcalFetch(
    `/calendars/${encodeURIComponent(cid)}/events/${encodeURIComponent(eventId)}`,
  );

  const event = await gcalFetch(
    `/calendars/${encodeURIComponent(cid)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      params: { supportsAttachments: "true" },
      body: {
        attachments: [
          ...(current.attachments || []),
          {
            fileUrl: file.webViewLink,
            title: file.name,
            mimeType: file.mimeType,
          },
        ],
      },
    },
  );
  return parseEvent(event);
}
/**
 * Utwórz nowy kalendarz
 */
export async function calendarCreateCalendar({ name, description, timeZone }) {
  if (!name) throw new Error("Brakuje name");
  const event = await gcalFetch("/calendars", {
    method: "POST",
    body: {
      summary: name,
      description: description || "",
      timeZone: timeZone || "Europe/Warsaw",
    },
  });
  return { id: event.id, name: event.summary, timeZone: event.timeZone };
}

/**
 * Usuń kalendarz (nie można usunąć primary!)
 */
export async function calendarDeleteCalendar({ calendarId }) {
  if (!calendarId) throw new Error("Brakuje calendarId");

  // Sprawdź czy to primary
  const cal = await gcalFetch(
    `/users/me/calendarList/${encodeURIComponent(calendarId)}`,
  );
  if (cal.primary) {
    throw new Error("Nie można usunąć kalendarza głównego (primary)!");
  }
  if (cal.accessRole === "reader" || cal.accessRole === "freeBusyReader") {
    // Subskrypcja (święta, cudze) — wypisz z listy
    await gcalFetch(
      `/users/me/calendarList/${encodeURIComponent(calendarId)}`,
      {
        method: "DELETE",
      },
    );
    return {
      calendarId,
      name: cal.summary,
      removed: true,
      type: "unsubscribed",
    };
  }
  // Wtórny kalendarz — usuń
  await gcalFetch(`/calendars/${encodeURIComponent(calendarId)}`, {
    method: "DELETE",
  });
  return { calendarId, name: cal.summary, deleted: true };
}
