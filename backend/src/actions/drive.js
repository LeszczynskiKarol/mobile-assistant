// Google Drive API
// Wymaga scope: https://www.googleapis.com/auth/drive.readonly

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

async function driveApi(path, params = {}) {
  const token = await getAccessToken();
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API ${res.status}: ${text}`);
  }
  return res.json();
}

function parseFile(f) {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    type: mimeToType(f.mimeType),
    size: f.size ? formatSize(parseInt(f.size)) : undefined,
    modifiedTime: f.modifiedTime,
    createdTime: f.createdTime,
    webViewLink: f.webViewLink,
    webContentLink: f.webContentLink,
    owners: f.owners?.map((o) => o.displayName || o.emailAddress),
    shared: f.shared,
    starred: f.starred,
    parent: f.parents?.[0],
  };
}

function mimeToType(mime) {
  if (!mime) return "unknown";
  if (mime.includes("folder")) return "folder";
  if (mime.includes("document")) return "doc";
  if (mime.includes("spreadsheet")) return "sheet";
  if (mime.includes("presentation")) return "slides";
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("image")) return "image";
  if (mime.includes("video")) return "video";
  if (mime.includes("audio")) return "audio";
  if (mime.includes("zip") || mime.includes("rar") || mime.includes("tar"))
    return "archive";
  return "file";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const FILE_FIELDS =
  "id,name,mimeType,size,modifiedTime,createdTime,webViewLink,webContentLink,owners,shared,starred,parents";

/**
 * Wyszukaj pliki na Drive
 */
export async function driveSearch({ query, maxResults = 15, type }) {
  if (!query) throw new Error("Brakuje query");

  // Buduj Drive query
  let q = `name contains '${query.replace(/'/g, "\\'")}'`;
  q += " and trashed = false";

  if (type) {
    const mimeMap = {
      doc: "application/vnd.google-apps.document",
      sheet: "application/vnd.google-apps.spreadsheet",
      slides: "application/vnd.google-apps.presentation",
      pdf: "application/pdf",
      folder: "application/vnd.google-apps.folder",
      image: "image/",
    };
    if (mimeMap[type]) {
      if (type === "image") {
        q += ` and mimeType contains 'image/'`;
      } else {
        q += ` and mimeType = '${mimeMap[type]}'`;
      }
    }
  }

  const data = await driveApi("files", {
    q,
    fields: `files(${FILE_FIELDS}),nextPageToken`,
    pageSize: String(Math.min(50, maxResults)),
    orderBy: "modifiedTime desc",
  });

  return {
    query,
    files: (data.files || []).map(parseFile),
    totalFound: data.files?.length || 0,
    hasMore: !!data.nextPageToken,
  };
}

/**
 * Lista ostatnio modyfikowanych plików
 */
export async function driveRecent({ maxResults = 15, type }) {
  let q = "trashed = false";

  if (type) {
    const mimeMap = {
      doc: "application/vnd.google-apps.document",
      sheet: "application/vnd.google-apps.spreadsheet",
      slides: "application/vnd.google-apps.presentation",
      pdf: "application/pdf",
      folder: "application/vnd.google-apps.folder",
    };
    if (mimeMap[type]) {
      q += ` and mimeType = '${mimeMap[type]}'`;
    }
  }

  const data = await driveApi("files", {
    q,
    fields: `files(${FILE_FIELDS})`,
    pageSize: String(Math.min(50, maxResults)),
    orderBy: "modifiedTime desc",
  });

  return {
    files: (data.files || []).map(parseFile),
    totalFound: data.files?.length || 0,
  };
}

/**
 * Szczegóły pliku
 */
export async function driveGetFile({ fileId }) {
  if (!fileId) throw new Error("Brakuje fileId");

  const file = await driveApi(`files/${fileId}`, {
    fields: FILE_FIELDS + ",description,properties",
  });

  return parseFile(file);
}

/**
 * Lista plików w folderze
 */
export async function driveListFolder({
  folderId,
  folderName,
  maxResults = 30,
}) {
  let id = folderId;

  // Znajdź folder po nazwie
  if (!id && folderName) {
    const search = await driveApi("files", {
      q: `name contains '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id,name)",
      pageSize: "5",
    });
    if (!search.files?.length)
      throw new Error(`Nie znaleziono folderu "${folderName}"`);
    id = search.files[0].id;
  }

  if (!id) throw new Error("Brakuje folderId lub folderName");

  const data = await driveApi("files", {
    q: `'${id}' in parents and trashed = false`,
    fields: `files(${FILE_FIELDS})`,
    pageSize: String(Math.min(100, maxResults)),
    orderBy: "folder,name",
  });

  return {
    folderId: id,
    files: (data.files || []).map(parseFile),
    totalFound: data.files?.length || 0,
  };
}

/**
 * Info o pojemności Drive
 */
export async function driveStorage() {
  const data = await driveApi("about", {
    fields: "storageQuota,user",
  });

  const q = data.storageQuota || {};
  return {
    user: data.user?.displayName || data.user?.emailAddress,
    usage: formatSize(parseInt(q.usage || 0)),
    limit: q.limit ? formatSize(parseInt(q.limit)) : "unlimited",
    usageInDrive: formatSize(parseInt(q.usageInDrive || 0)),
    usageInTrash: formatSize(parseInt(q.usageInDriveTrash || 0)),
  };
}

/**
 * Pobierz i przeczytaj zawartość pliku z Drive
 * Google Docs → export jako text, PDF/DOCX → scraper, obrazy → vision
 */
export async function driveReadContent({ fileId, maxChars = 300000 }) {
  if (!fileId) throw new Error("Brakuje fileId");
  const token = await getAccessToken();

  // 1. Pobierz metadane pliku
  const file = await driveApi("files/" + fileId, {
    fields: "id,name,mimeType,size",
  });

  const mime = file.mimeType;
  const SCRAPER_URL = process.env.SCRAPER_URL;

  // 2. Google Workspace docs → export jako plain text
  if (mime === "application/vnd.google-apps.document") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Export failed: ${res.status}`);
    const text = await res.text();
    return {
      fileId,
      name: file.name,
      type: "doc",
      content: text.slice(0, maxChars),
      chars: text.length,
    };
  }

  if (mime === "application/vnd.google-apps.spreadsheet") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Export failed: ${res.status}`);
    const text = await res.text();
    return {
      fileId,
      name: file.name,
      type: "sheet",
      content: text.slice(0, maxChars),
      chars: text.length,
    };
  }

  if (mime === "application/vnd.google-apps.presentation") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Export failed: ${res.status}`);
    const text = await res.text();
    return {
      fileId,
      name: file.name,
      type: "slides",
      content: text.slice(0, maxChars),
      chars: text.length,
    };
  }

  // 3. PDF/DOCX → pobierz i wyślij do scrapera
  if (
    mime === "application/pdf" ||
    mime.includes("word") ||
    mime.includes("document")
  ) {
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);
    const buffer = Buffer.from(await dlRes.arrayBuffer());

    // Upload do S3 i scrape
    const { uploadToS3, getSignedDownloadUrl } = await import("./s3.js");
    const { key } = await uploadToS3(buffer, file.name, mime);
    const signedUrl = await getSignedDownloadUrl(key);

    const scrapeRes = await fetch(`${SCRAPER_URL}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: signedUrl }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!scrapeRes.ok) throw new Error(`Scraper failed: ${scrapeRes.status}`);
    const data = await scrapeRes.json();
    const text = (data.text || "").slice(0, maxChars);
    return {
      fileId,
      name: file.name,
      type: "pdf",
      content: text,
      chars: text.length,
    };
  }

  // 4. Obrazy → pobierz i Claude Vision
  if (mime.startsWith("image/")) {
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);
    const buffer = Buffer.from(await dlRes.arrayBuffer());
    const base64 = buffer.toString("base64");

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mime, data: base64 },
            },
            {
              type: "text",
              text: "Opisz szczegółowo co widzisz. Jeśli to tekst/dokument — wyodrębnij treść. Po polsku.",
            },
          ],
        },
      ],
    });
    const desc = response.content[0]?.text || "";
    return {
      fileId,
      name: file.name,
      type: "image",
      content: desc,
      chars: desc.length,
    };
  }

  // 5. Tekst plain → bezpośrednio
  if (mime.startsWith("text/") || mime === "application/json") {
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);
    const text = await dlRes.text();
    return {
      fileId,
      name: file.name,
      type: "text",
      content: text.slice(0, maxChars),
      chars: text.length,
    };
  }

  throw new Error(`Nie mogę odczytać pliku typu: ${mime}`);
}

export async function driveShare({
  fileId,
  email,
  role = "reader",
  notify = true,
}) {
  if (!fileId || !email) throw new Error("Brakuje fileId lub email");
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=${notify}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "user", role, emailAddress: email }),
    },
  );
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
  return { fileId, sharedWith: email, role };
}

export async function driveExport({ fileId, mimeType = "application/pdf" }) {
  if (!fileId) throw new Error("Brakuje fileId");
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Export ${res.status}: ${await res.text()}`);
  return {
    fileId,
    exportUrl: `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`,
    mimeType,
  };
}

/**
 * Przenieś plik do kosza (odwracalne)
 */
export async function driveTrash({ fileId }) {
  if (!fileId) throw new Error("Brakuje fileId");
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trashed: true }),
    },
  );
  if (!res.ok)
    throw new Error(`Drive trash: ${res.status}: ${await res.text()}`);
  const file = await res.json();
  return { fileId, name: file.name, trashed: true };
}

/**
 * Przywróć plik z kosza
 */
export async function driveUntrash({ fileId }) {
  if (!fileId) throw new Error("Brakuje fileId");
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trashed: false }),
    },
  );
  if (!res.ok)
    throw new Error(`Drive untrash: ${res.status}: ${await res.text()}`);
  const file = await res.json();
  return { fileId, name: file.name, trashed: false };
}

/**
 * Usuń plik na stałe (NIEODWRACALNE!)
 */
export async function driveDelete({ fileId }) {
  if (!fileId) throw new Error("Brakuje fileId");
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok)
    throw new Error(`Drive delete: ${res.status}: ${await res.text()}`);
  return { fileId, deleted: true };
}

/**
 * Masowe przeniesienie do kosza (do 50 plików)
 */
export async function driveBatchTrash({ fileIds }) {
  if (!fileIds?.length) throw new Error("Brakuje fileIds");
  if (fileIds.length > 50) throw new Error("Max 50 plików na raz");
  const token = await getAccessToken();

  const results = [];
  for (const fileId of fileIds) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ trashed: true }),
        },
      );
      if (res.ok) {
        const file = await res.json();
        results.push({ fileId, name: file.name, status: "trashed" });
      } else {
        results.push({ fileId, status: "error", error: `HTTP ${res.status}` });
      }
    } catch (err) {
      results.push({ fileId, status: "error", error: err.message });
    }
  }

  return {
    total: fileIds.length,
    trashed: results.filter((r) => r.status === "trashed").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  };
}

/**
 * Opróżnij kosz
 */
export async function driveEmptyTrash() {
  const token = await getAccessToken();
  const res = await fetch("https://www.googleapis.com/drive/v3/files/trash", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw new Error(`Drive emptyTrash: ${res.status}: ${await res.text()}`);
  return { emptied: true };
}

/**
 * Edytuj metadane pliku (nazwa, opis, gwiazdka)
 */
export async function driveUpdate({ fileId, name, description, starred }) {
  if (!fileId) throw new Error("Brakuje fileId");
  const token = await getAccessToken();
  const body = {};
  if (name !== undefined) body.name = name;
  if (description !== undefined) body.description = description;
  if (starred !== undefined) body.starred = starred;

  if (Object.keys(body).length === 0) throw new Error("Brak pól do edycji");

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=${FILE_FIELDS}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok)
    throw new Error(`Drive update: ${res.status}: ${await res.text()}`);
  return parseFile(await res.json());
}

/**
 * Przenieś plik do innego folderu
 */
export async function driveMove({ fileId, folderId, folderName }) {
  if (!fileId) throw new Error("Brakuje fileId");
  const token = await getAccessToken();

  // Znajdź folder po nazwie
  let targetId = folderId;
  if (!targetId && folderName) {
    const search = await driveApi("files", {
      q: `name contains '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id,name)",
      pageSize: "3",
    });
    if (!search.files?.length)
      throw new Error(`Nie znaleziono folderu "${folderName}"`);
    targetId = search.files[0].id;
  }
  if (!targetId) throw new Error("Brakuje folderId lub folderName");

  // Pobierz aktualnych rodziców
  const file = await driveApi(`files/${fileId}`, { fields: "parents,name" });
  const previousParents = (file.parents || []).join(",");

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${targetId}&removeParents=${previousParents}&fields=id,name,parents`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    },
  );
  if (!res.ok)
    throw new Error(`Drive move: ${res.status}: ${await res.text()}`);
  const moved = await res.json();
  return { fileId, name: moved.name, movedTo: targetId };
}

/**
 * Utwórz folder
 */
export async function driveCreateFolder({ name, parentId }) {
  if (!name) throw new Error("Brakuje name");
  const token = await getAccessToken();
  const body = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) body.parents = [parentId];

  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok)
    throw new Error(`Drive createFolder: ${res.status}: ${await res.text()}`);
  const folder = await res.json();
  return { id: folder.id, name: folder.name, link: folder.webViewLink };
}
