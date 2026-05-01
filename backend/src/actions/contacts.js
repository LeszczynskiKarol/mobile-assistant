// Google People API (Contacts)
// Wymaga scope: https://www.googleapis.com/auth/contacts.readonly

const GMAIL_FROM = process.env.GMAIL_FROM;

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
  const data = await res.json();
  if (data.error) throw new Error(`OAuth: ${data.error_description}`);
  return data.access_token;
}

async function peopleApi(path, params = {}) {
  const token = await getAccessToken();
  const url = new URL(`https://people.googleapis.com/v1/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`People API ${res.status}: ${text}`);
  }
  return res.json();
}

function parseContact(person) {
  const names = person.names?.[0];
  const emails =
    person.emailAddresses?.map((e) => ({
      email: e.value,
      type: e.type || "other",
    })) || [];
  const phones =
    person.phoneNumbers?.map((p) => ({
      number: p.value,
      type: p.type || "other",
    })) || [];
  const orgs =
    person.organizations?.map((o) => ({
      name: o.name,
      title: o.title,
    })) || [];

  return {
    name: names?.displayName || "(brak nazwy)",
    givenName: names?.givenName,
    familyName: names?.familyName,
    emails,
    phones,
    organizations: orgs.length ? orgs : undefined,
    photo: person.photos?.[0]?.url,
  };
}

/**
 * Wyszukaj kontakty po nazwie lub emailu
 */
export async function contactsSearch({ query, maxResults = 10 }) {
  if (!query) throw new Error("Brakuje query");

  const data = await peopleApi("people:searchContacts", {
    query,
    readMask: "names,emailAddresses,phoneNumbers,organizations,photos",
    pageSize: String(Math.min(30, maxResults)),
  });

  const results = (data.results || []).map((r) => parseContact(r.person));

  return {
    query,
    contacts: results,
    totalFound: results.length,
  };
}

/**
 * Lista kontaktów (ostatnio modyfikowane)
 */
export async function contactsList({ maxResults = 20 }) {
  const data = await peopleApi("people/me/connections", {
    personFields: "names,emailAddresses,phoneNumbers,organizations",
    pageSize: String(Math.min(100, maxResults)),
    sortOrder: "LAST_MODIFIED_DESCENDING",
  });

  const results = (data.connections || []).map(parseContact);

  return {
    contacts: results,
    totalFound: results.length,
    totalPeople: data.totalPeople || results.length,
  };
}

/**
 * Szukaj kontaktu i zwróć email (helper dla wysyłki maili)
 */
export async function contactsGetEmail({ name }) {
  if (!name) throw new Error("Brakuje name");

  const polishToAscii = (s) =>
    s
      .replace(/ł/g, "l")
      .replace(/ń/g, "n")
      .replace(/ś/g, "s")
      .replace(/ź/g, "z")
      .replace(/ż/g, "z")
      .replace(/ć/g, "c")
      .replace(/ę/g, "e")
      .replace(/ą/g, "a")
      .replace(/ó/g, "o");

  // 1. Szukaj w głównych kontaktach
  const data = await peopleApi("people:searchContacts", {
    query: name,
    readMask: "names,emailAddresses",
    pageSize: "5",
  });

  let results = (data.results || [])
    .map((r) => parseContact(r.person))
    .filter((c) => c.emails.length > 0);

  // 2. Fallback: Other Contacts
  if (results.length === 0) {
    try {
      const other = await peopleApi("otherContacts:search", {
        query: name,
        readMask: "names,emailAddresses",
        pageSize: "5",
      });
      results = (other.results || [])
        .map((r) => parseContact(r.person))
        .filter((c) => c.emails.length > 0);
    } catch {}
  }

  // 3. Fallback: Gmail history
  if (results.length === 0) {
    try {
      const token = await getAccessToken();
      const searchQ = encodeURIComponent(name);
      const gmailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${searchQ}&maxResults=10`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const gmailData = await gmailRes.json();
      const contacts = new Map();
      const nameLower = name.toLowerCase();
      const nameAscii = polishToAscii(nameLower);

      for (const msg of (gmailData.messages || []).slice(0, 5)) {
        const detail = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const d = await detail.json();
        for (const h of d.payload?.headers || []) {
          const fullMatch = h.value.match(/([^<]*)<([^>]+@[^>]+)>/);
          if (fullMatch) {
            const displayName = fullMatch[1].trim().replace(/"/g, "");
            const email = fullMatch[2].toLowerCase();
            if (email === (process.env.GMAIL_FROM || "").toLowerCase())
              continue;
            if (email.startsWith("no-reply") || email.startsWith("noreply"))
              continue;
            if (
              email.includes("notification") ||
              email.includes("mailer-daemon") ||
              email.includes("postmaster") ||
              email.endsWith("@google.com") ||
              email.endsWith("@googlemail.com") ||
              email.includes("@noreply.")
            )
              continue;
            const displayLower = displayName.toLowerCase();
            const nameMatch =
              displayLower.includes(nameLower) ||
              nameLower
                .split(" ")
                .every((part) => displayLower.includes(part)) ||
              nameAscii.split(" ").every((part) => email.includes(part));
            if (!contacts.has(email)) {
              contacts.set(email, {
                name: displayName || email,
                email,
                count: 0,
                nameMatch,
              });
            }
            contacts.get(email).count++;
          } else {
            const plainEmail = h.value.trim().toLowerCase();
            if (
              plainEmail.includes("@") &&
              plainEmail !== (process.env.GMAIL_FROM || "").toLowerCase()
            ) {
              if (
                plainEmail.startsWith("no-reply") ||
                plainEmail.startsWith("noreply")
              )
                continue;
              if (
                plainEmail.includes("notification") ||
                plainEmail.endsWith("@google.com")
              )
                continue;
              const nameMatch = nameAscii
                .split(" ")
                .every((part) => plainEmail.includes(part));
              if (!contacts.has(plainEmail)) {
                contacts.set(plainEmail, {
                  name: plainEmail,
                  email: plainEmail,
                  count: 0,
                  nameMatch,
                });
              }
              contacts.get(plainEmail).count++;
            }
          }
        }
      }

      const matched = [...contacts.values()].filter((c) => c.nameMatch);
      if (matched.length > 0) {
        matched.sort((a, b) => b.count - a.count);
        return {
          name: matched[0].name,
          email: matched[0].email,
          allEmails: matched.map((c) => ({
            email: c.email,
            type: "gmail-history",
          })),
          otherMatches: matched
            .slice(1)
            .map((c) => ({ name: c.name, email: c.email })),
        };
      }
    } catch {}
  }

  if (results.length === 0) {
    throw new Error(`Nie znaleziono kontaktu "${name}" z emailem`);
  }

  return {
    name: results[0].name,
    email: results[0].emails[0].email,
    allEmails: results[0].emails,
    otherMatches: results
      .slice(1)
      .map((c) => ({ name: c.name, email: c.emails[0]?.email })),
  };
}

/**
 * Szukaj emaila w historii Gmail (nadawcy/odbiorcy)
 */
export async function contactsFromGmail({ name, maxResults = 5 }) {
  if (!name) throw new Error("Brakuje name");
  const token = await getAccessToken();
  const polishToAscii = (s) =>
    s
      .replace(/ł/g, "l")
      .replace(/ń/g, "n")
      .replace(/ś/g, "s")
      .replace(/ź/g, "z")
      .replace(/ż/g, "z")
      .replace(/ć/g, "c")
      .replace(/ę/g, "e")
      .replace(/ą/g, "a")
      .replace(/ó/g, "o");

  const searchQ = encodeURIComponent(name);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${searchQ}&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  const contacts = new Map();

  for (const msg of data.messages || []) {
    const detail = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const d = await detail.json();

    for (const h of d.payload?.headers || []) {
      const fullMatch = h.value.match(/([^<]*)<([^>]+@[^>]+)>/);
      if (fullMatch) {
        const displayName = fullMatch[1].trim().replace(/"/g, "");
        const email = fullMatch[2].toLowerCase();
        if (email === (process.env.GMAIL_FROM || "").toLowerCase()) continue;
        if (email.startsWith("no-reply") || email.startsWith("noreply"))
          continue;
        if (email.includes("notification") || email.endsWith("@google.com"))
          continue;
        if (!contacts.has(email)) {
          contacts.set(email, { name: displayName || email, email, count: 0 });
        }
        contacts.get(email).count++;
      } else {
        const plainEmail = h.value.trim().toLowerCase();
        if (
          plainEmail.includes("@") &&
          plainEmail !== (process.env.GMAIL_FROM || "").toLowerCase()
        ) {
          if (
            plainEmail.startsWith("no-reply") ||
            plainEmail.endsWith("@google.com")
          )
            continue;
          if (!contacts.has(plainEmail)) {
            contacts.set(plainEmail, {
              name: plainEmail,
              email: plainEmail,
              count: 0,
            });
          }
          contacts.get(plainEmail).count++;
        }
      }
    }
  }

  const results = [...contacts.values()].sort((a, b) => b.count - a.count);

  return {
    query: name,
    found: results,
    totalFound: results.length,
  };
}
