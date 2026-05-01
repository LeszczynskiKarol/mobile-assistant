/**
 * Jednorazowy skrypt do uzyskania Google OAuth2 refresh token
 * z pełnymi scope'ami Gmail + Calendar.
 *
 * Użycie:
 *   node gmail-get-token.js
 *
 * Wymaga: GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET w .env
 */

import "dotenv/config";
import { createServer } from "http";
import { URL } from "url";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3333/oauth2callback";

const SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/drive",
].join(" ");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "❌ Ustaw GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET w pliku .env",
  );
  process.exit(1);
}

// Krok 1: Zbuduj URL autoryzacji
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent"); // wymusza nowy refresh_token

console.log("\n🔗 Otwórz ten URL w przeglądarce:\n");
console.log(authUrl.toString());
console.log("\n⏳ Czekam na callback na http://localhost:3333 ...\n");

// Krok 2: Lokaly serwer na callback
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:3333`);

  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    console.error(`❌ Błąd autoryzacji: ${error}`);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>❌ Błąd: ${error}</h1><p>Zamknij tę kartę.</p>`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400);
    res.end("Brak kodu autoryzacji");
    return;
  }

  console.log("✅ Otrzymano kod autoryzacji, wymieniam na tokeny...");

  // Krok 3: Wymień code na tokeny
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error(
        `❌ Błąd tokena: ${tokenData.error} — ${tokenData.error_description}`,
      );
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<h1>❌ Błąd</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`,
      );
      server.close();
      process.exit(1);
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ SUKCES! Tokeny uzyskane:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    if (tokenData.refresh_token) {
      console.log(
        "🔑 REFRESH TOKEN (wpisz do .env jako GOOGLE_REFRESH_TOKEN):",
      );
      console.log(`\n   ${tokenData.refresh_token}\n`);
    } else {
      console.log(
        "⚠️  Brak refresh_token — prawdopodobnie już wcześniej autoryzowałeś.",
      );
      console.log("   Użyj prompt=consent w URL lub odwołaj dostęp na:");
      console.log("   https://myaccount.google.com/permissions\n");
    }

    console.log(
      `📊 Access Token (ważny ${tokenData.expires_in}s): ${tokenData.access_token?.slice(0, 30)}...`,
    );
    console.log(`📊 Scope: ${tokenData.scope}`);
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\nTeraz wpisz do .env:");
    console.log(
      `GOOGLE_REFRESH_TOKEN=${tokenData.refresh_token || "BRAK — odwołaj dostęp i spróbuj ponownie"}`,
    );
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <html>
      <body style="font-family: system-ui; padding: 40px; background: #0f172a; color: #f1f5f9;">
        <h1>✅ Autoryzacja udana!</h1>
        <p>Refresh token wyświetlony w terminalu.</p>
        <p>Możesz zamknąć tę kartę.</p>
        ${tokenData.refresh_token ? `<pre style="background: #1e293b; padding: 16px; border-radius: 8px; word-break: break-all;">GOOGLE_REFRESH_TOKEN=${tokenData.refresh_token}</pre>` : ""}
      </body>
      </html>
    `);
  } catch (err) {
    console.error(`❌ Błąd: ${err.message}`);
    res.writeHead(500);
    res.end(`Error: ${err.message}`);
  }

  server.close();
});

server.listen(3333, async () => {
  // Próba otwarcia przeglądarki
  try {
    const { exec } = await import("child_process");
    const cmd =
      process.platform === "win32"
        ? "start"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";
    exec(`${cmd} "${authUrl.toString().replace(/&/g, "^&")}"`, () => {});
  } catch {
    console.log(
      "⚠️  Nie udało się otworzyć przeglądarki automatycznie. Skopiuj URL powyżej.",
    );
  }
});
