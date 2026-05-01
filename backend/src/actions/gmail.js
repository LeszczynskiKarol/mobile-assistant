// Gmail REST API z OAuth2 — kompleksowe zarządzanie
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

let cachedAccessToken = null;
let tokenExpiresAt = 0;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google OAuth error: ${err}`);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedAccessToken;
}

async function gmailFetch(path, opts = {}) {
  const token = await getAccessToken();
  const url = `${GMAIL_API}${path}`;
  const fetchOpts = {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (opts.body) {
    fetchOpts.body =
      typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  if (opts.rawBody) {
    fetchOpts.body = opts.rawBody;
    fetchOpts.headers["Content-Type"] = "message/rfc822";
  }

  const res = await fetch(url, fetchOpts);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail ${res.status}: ${text}`);
  }

  // DELETE returns 204 no content
  if (res.status === 204) return { success: true };
  return res.json();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function decodeBase64Url(str) {
  if (!str) return "";
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function encodeBase64Url(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getHeader(headers, name) {
  const h = headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

/**
 * Wyciąga treść z payload — obsługuje multipart i plain
 */
function extractBody(payload) {
  if (!payload) return "";

  // Prosty plain/html
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart — szukaj text/plain, fallback text/html
  if (payload.parts) {
    // Najpierw szukaj text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Fallback: text/html → strip tags
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = decodeBase64Url(part.body.data);
        return html
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
    // Nested multipart
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }

  return "";
}

/**
 * Wyciąga info o załącznikach
 */
function extractAttachments(payload) {
  const attachments = [];

  function walk(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size,
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts) walk(part.parts);
    }
  }

  walk(payload?.parts);
  return attachments;
}

/**
 * Parsuje email do czytelnego obiektu
 */
function parseMessage(msg, includeBody = false) {
  const headers = msg.payload?.headers || [];
  const result = {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    cc: getHeader(headers, "Cc") || undefined,
    subject: getHeader(headers, "Subject"),
    date: getHeader(headers, "Date"),
    snippet: msg.snippet,
    labels: msg.labelIds || [],
    isUnread: msg.labelIds?.includes("UNREAD"),
    isStarred: msg.labelIds?.includes("STARRED"),
    hasAttachments: false,
    attachments: [],
  };

  if (includeBody) {
    result.body = extractBody(msg.payload);
    result.attachments = extractAttachments(msg.payload);
    result.hasAttachments = result.attachments.length > 0;
  } else {
    // Check for attachments without full parse
    result.hasAttachments =
      msg.payload?.parts?.some((p) => p.filename && p.body?.attachmentId) ||
      false;
  }

  return result;
}

function encodeEmail({
  to,
  cc,
  subject,
  body,
  from,
  inReplyTo,
  references,
  threadId,
}) {
  const lines = [`From: ${from || process.env.GMAIL_FROM}`, `To: ${to}`];
  if (cc) lines.push(`Cc: ${cc}`);
  lines.push(`Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`);
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=UTF-8");
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${references || inReplyTo}`);
  }
  lines.push("", body);

  return encodeBase64Url(lines.join("\r\n"));
}

function encodeHtmlEmail({
  to,
  cc,
  subject,
  htmlBody,
  textBody,
  from,
  inReplyTo,
  references,
}) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines = [`From: ${from || process.env.GMAIL_FROM}`, `To: ${to}`];
  if (cc) lines.push(`Cc: ${cc}`);
  lines.push(`Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`);
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${references || inReplyTo}`);
  }
  lines.push("");
  lines.push(`--${boundary}`);
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("");
  lines.push(
    textBody ||
      htmlBody
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
  );
  lines.push(`--${boundary}`);
  lines.push("Content-Type: text/html; charset=UTF-8");
  lines.push("");
  lines.push(htmlBody);
  lines.push(`--${boundary}--`);

  return encodeBase64Url(lines.join("\r\n"));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AKCJE PUBLICZNE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Lista emaili z filtrami
 * @param {Object} params
 * @param {string} [params.query] - Gmail search query (np. "is:unread", "from:jan@x.pl", "subject:faktura")
 * @param {number} [params.maxResults=10] - ile emaili (1-50)
 * @param {string} [params.label] - filtruj po etykiecie (INBOX, SENT, DRAFT, STARRED, UNREAD, SPAM, TRASH)
 * @param {string} [params.pageToken] - token do paginacji
 */
export async function gmailList({
  query,
  maxResults = 10,
  label,
  pageToken,
} = {}) {
  const params = new URLSearchParams();
  params.set("maxResults", String(Math.min(50, Math.max(1, maxResults))));

  // Buduj query
  const queryParts = [];
  if (query) queryParts.push(query);
  if (label) {
    const labelUpper = label.toUpperCase();
    // Specjalne etykiety jako query
    if (["UNREAD", "STARRED"].includes(labelUpper)) {
      queryParts.push(`is:${labelUpper.toLowerCase()}`);
    } else {
      params.set("labelIds", labelUpper);
    }
  }
  if (queryParts.length > 0) {
    params.set("q", queryParts.join(" "));
  }
  if (pageToken) params.set("pageToken", pageToken);

  const listResult = await gmailFetch(`/messages?${params}`);

  if (!listResult.messages?.length) {
    return { emails: [], total: 0, nextPageToken: null };
  }

  // Pobierz metadane każdego emaila (format=metadata jest szybszy niż full)
  const emails = await Promise.all(
    listResult.messages.map((m) =>
      gmailFetch(
        `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Cc`,
      ).then((msg) => parseMessage(msg, false)),
    ),
  );

  return {
    emails,
    total: listResult.resultSizeEstimate || emails.length,
    nextPageToken: listResult.nextPageToken || null,
  };
}

/**
 * Przeczytaj pełną treść emaila
 * @param {Object} params
 * @param {string} params.messageId - ID emaila
 * @param {boolean} [params.markAsRead=true] - automatycznie oznacz jako przeczytany
 */
export async function gmailRead({ messageId, markAsRead = true }) {
  if (!messageId) throw new Error("Brakuje messageId");

  const msg = await gmailFetch(`/messages/${messageId}?format=full`);
  const parsed = parseMessage(msg, true);

  // Automatycznie oznacz jako przeczytany
  if (markAsRead && parsed.isUnread) {
    await gmailFetch(`/messages/${messageId}/modify`, {
      method: "POST",
      body: { removeLabelIds: ["UNREAD"] },
    }).catch(() => {}); // nie blokuj jeśli się nie uda
  }

  return parsed;
}

/**
 * Wyszukaj emaile (Gmail search syntax)
 * @param {Object} params
 * @param {string} params.query - wyszukiwarka Gmail (np. "from:jan subject:raport after:2025/01/01")
 * @param {number} [params.maxResults=10]
 */
export async function gmailSearch({ query, maxResults = 10 }) {
  if (!query) throw new Error("Brakuje query");
  return gmailList({ query, maxResults });
}

/**
 * Wyślij email
 */
export async function gmailSend({ to, subject, body, cc, htmlBody }) {
  if (!to || !subject) throw new Error("Brakuje to lub subject");
  if (!body && !htmlBody) throw new Error("Brakuje body lub htmlBody");

  let raw;
  if (htmlBody) {
    raw = encodeHtmlEmail({ to, cc, subject, htmlBody, textBody: body });
  } else {
    raw = encodeEmail({ to, cc, subject, body });
  }

  const result = await gmailFetch("/messages/send", {
    method: "POST",
    body: { raw },
  });

  return { messageId: result.id, threadId: result.threadId, to, cc, subject };
}

/**
 * Odpowiedz na email
 * @param {Object} params
 * @param {string} params.messageId - ID emaila na który odpowiadamy
 * @param {string} params.body - treść odpowiedzi
 * @param {boolean} [params.replyAll=false] - odpowiedz wszystkim
 */
export async function gmailReply({ messageId, body, replyAll = false }) {
  if (!messageId || !body) throw new Error("Brakuje messageId lub body");

  // Pobierz oryginalny email
  const original = await gmailFetch(
    `/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`,
  );
  const headers = original.payload?.headers || [];

  const from = getHeader(headers, "From");
  const to = getHeader(headers, "To");
  const cc = getHeader(headers, "Cc");
  const subject = getHeader(headers, "Subject");
  const messageIdHeader = getHeader(headers, "Message-ID");
  const references = getHeader(headers, "References");

  // Ustaw odbiorcę — reply to sender, reply-all to sender + cc
  let replyTo = from;
  let replyCc = undefined;
  if (replyAll) {
    // Dodaj oryginalnych odbiorców (bez siebie) do CC
    const myEmail = process.env.GMAIL_FROM.toLowerCase();
    const allRecipients = [to, cc].filter(Boolean).join(", ");
    const ccList = allRecipients
      .split(",")
      .map((e) => e.trim())
      .filter(
        (e) =>
          !e.toLowerCase().includes(myEmail) &&
          !e.toLowerCase().includes(from.toLowerCase()),
      );
    if (ccList.length > 0) replyCc = ccList.join(", ");
  }

  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;

  const raw = encodeEmail({
    to: replyTo,
    cc: replyCc,
    subject: replySubject,
    body,
    inReplyTo: messageIdHeader,
    references: references
      ? `${references} ${messageIdHeader}`
      : messageIdHeader,
  });

  const result = await gmailFetch("/messages/send", {
    method: "POST",
    body: { raw, threadId: original.threadId },
  });

  return {
    messageId: result.id,
    threadId: result.threadId,
    to: replyTo,
    cc: replyCc,
    subject: replySubject,
    inReplyTo: messageIdHeader,
  };
}

/**
 * Prześlij dalej email
 * @param {Object} params
 * @param {string} params.messageId - ID emaila do przesłania
 * @param {string} params.to - odbiorca
 * @param {string} [params.comment] - dodatkowy komentarz na górze
 */
export async function gmailForward({ messageId, to, comment }) {
  if (!messageId || !to) throw new Error("Brakuje messageId lub to");

  const original = await gmailFetch(`/messages/${messageId}?format=full`);
  const parsed = parseMessage(original, true);

  const forwardBody = [
    comment || "",
    "",
    "---------- Forwarded message ----------",
    `From: ${parsed.from}`,
    `Date: ${parsed.date}`,
    `Subject: ${parsed.subject}`,
    `To: ${parsed.to}`,
    parsed.cc ? `Cc: ${parsed.cc}` : "",
    "",
    parsed.body,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const fwdSubject = parsed.subject.startsWith("Fwd:")
    ? parsed.subject
    : `Fwd: ${parsed.subject}`;

  const raw = encodeEmail({ to, subject: fwdSubject, body: forwardBody });

  const result = await gmailFetch("/messages/send", {
    method: "POST",
    body: { raw },
  });

  return {
    messageId: result.id,
    threadId: result.threadId,
    to,
    subject: fwdSubject,
  };
}

/**
 * Utwórz draft
 */
export async function gmailDraft({ to, subject, body, cc, htmlBody }) {
  if (!to || !subject) throw new Error("Brakuje to lub subject");
  if (!body && !htmlBody) throw new Error("Brakuje body lub htmlBody");

  let raw;
  if (htmlBody) {
    raw = encodeHtmlEmail({ to, cc, subject, htmlBody, textBody: body });
  } else {
    raw = encodeEmail({ to, cc, subject, body });
  }

  const result = await gmailFetch("/drafts", {
    method: "POST",
    body: { message: { raw } },
  });

  return { draftId: result.id, to, cc, subject };
}

/**
 * Przenieś do kosza
 */
export async function gmailTrash({ messageId }) {
  if (!messageId) throw new Error("Brakuje messageId");
  await gmailFetch(`/messages/${messageId}/trash`, { method: "POST" });
  return { messageId, trashed: true };
}

/**
 * Przywróć z kosza
 */
export async function gmailUntrash({ messageId }) {
  if (!messageId) throw new Error("Brakuje messageId");
  await gmailFetch(`/messages/${messageId}/untrash`, { method: "POST" });
  return { messageId, untrashed: true };
}

/**
 * Oznacz jako przeczytany/nieprzeczytany
 */
export async function gmailMarkRead({ messageId, read = true }) {
  if (!messageId) throw new Error("Brakuje messageId");
  const body = read
    ? { removeLabelIds: ["UNREAD"] }
    : { addLabelIds: ["UNREAD"] };
  await gmailFetch(`/messages/${messageId}/modify`, { method: "POST", body });
  return { messageId, isUnread: !read };
}

/**
 * Oznacz gwiazdką / odznacz
 */
export async function gmailStar({ messageId, starred = true }) {
  if (!messageId) throw new Error("Brakuje messageId");
  const body = starred
    ? { addLabelIds: ["STARRED"] }
    : { removeLabelIds: ["STARRED"] };
  await gmailFetch(`/messages/${messageId}/modify`, { method: "POST", body });
  return { messageId, isStarred: starred };
}

/**
 * Zarządzanie etykietami
 */
export async function gmailModifyLabels({
  messageId,
  addLabels,
  removeLabels,
}) {
  if (!messageId) throw new Error("Brakuje messageId");
  const body = {};
  if (addLabels?.length) body.addLabelIds = addLabels;
  if (removeLabels?.length) body.removeLabelIds = removeLabels;
  await gmailFetch(`/messages/${messageId}/modify`, { method: "POST", body });
  return { messageId, addedLabels: addLabels, removedLabels: removeLabels };
}

/**
 * Lista etykiet użytkownika
 */
export async function gmailGetLabels() {
  const result = await gmailFetch("/labels");
  return {
    labels: (result.labels || []).map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type, // system vs user
      messagesTotal: l.messagesTotal,
      messagesUnread: l.messagesUnread,
    })),
  };
}

/**
 * Pobierz wątek (thread) — wszystkie emaile w konwersacji
 */
export async function gmailGetThread({ threadId, maxResults = 20 }) {
  if (!threadId) throw new Error("Brakuje threadId");

  const thread = await gmailFetch(`/threads/${threadId}?format=full`);

  const messages = (thread.messages || [])
    .slice(0, maxResults)
    .map((msg) => parseMessage(msg, true));

  return {
    threadId: thread.id,
    messageCount: messages.length,
    messages,
  };
}

/**
 * Zbiorcze operacje na wielu emailach
 */
export async function gmailBatchModify({
  messageIds,
  addLabels,
  removeLabels,
}) {
  if (!messageIds?.length) throw new Error("Brakuje messageIds");
  await gmailFetch("/messages/batchModify", {
    method: "POST",
    body: {
      ids: messageIds,
      addLabelIds: addLabels || [],
      removeLabelIds: removeLabels || [],
    },
  });
  return {
    modified: messageIds.length,
    addedLabels: addLabels,
    removedLabels: removeLabels,
  };
}

/**
 * Profil — info o koncie
 */
export async function gmailProfile() {
  const profile = await gmailFetch("/profile");

  return {
    email: profile.emailAddress,
    messagesTotal: profile.messagesTotal,
    threadsTotal: profile.threadsTotal,
    historyId: profile.historyId,
  };
}
