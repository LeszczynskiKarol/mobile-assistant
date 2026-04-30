import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;
const SCRAPER_URL = process.env.SCRAPER_URL;

// ── Google Custom Search ──────────────────────────────────────

async function googleSearch(query) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", GOOGLE_API_KEY);
  url.searchParams.set("cx", GOOGLE_CX);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "10");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Google Search ${res.status}: ${await res.text()}`);
  const data = await res.json();

  return (data.items || []).map((item) => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet || "",
    displayLink: item.displayLink,
  }));
}

// ── Scraper ───────────────────────────────────────────────────

async function scrapeUrl(url) {
  try {
    const res = await fetch(`${SCRAPER_URL}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(120_000), // 2 min timeout
    });
    if (!res.ok) return { url, text: "", error: `Scraper ${res.status}` };
    const data = await res.json();
    // Limit do ~8000 znaków per źródło (żeby nie przekroczyć context window)
    const text = (data.text || "").slice(0, 8000);
    return { url, text, error: null };
  } catch (err) {
    return { url, text: "", error: err.message };
  }
}

async function scrapeMultiple(urls) {
  // Scrapuj równolegle (max 5)
  return Promise.all(urls.slice(0, 5).map(scrapeUrl));
}

// ── Claude: czy potrzebny research? ───────────────────────────

export async function needsResearch(userMessage, model) {
  const res = await client.messages.create({
    model,
    max_tokens: 200,
    system: `Jesteś klasyfikatorem. Oceń czy zapytanie użytkownika wymaga aktualnych informacji z internetu.

Odpowiedz TYLKO JSON:
{"needsResearch": true/false, "reason": "krótkie uzasadnienie"}

Potrzebuje researchu: pytania o aktualne wydarzenia, ceny, newsy, konkretne firmy, produkty, technologie, pogodę, statystyki, przepisy prawne, porównania produktów.
NIE potrzebuje: rozmowa, akcje (Trello/Gmail/Calendar), proste pytania na które znasz odpowiedź, polecenia do wykonania.`,
    messages: [{ role: "user", content: userMessage }],
  });

  const raw = res.content[0]?.text || "";
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { needsResearch: false, reason: "parse error" };
  }
}

// ── Claude: generuj zapytanie do Google ───────────────────────

async function generateSearchQuery(userMessage, model, language = "pl") {
  const res = await client.messages.create({
    model,
    max_tokens: 100,
    system: `Wygeneruj KRÓTKIE zapytanie do Google Search (2-4 słowa) na podstawie pytania użytkownika.
Język zapytania: ${language === "en" ? "ANGIELSKI" : "POLSKI"}.
Zwróć TYLKO JSON: {"query": "zapytanie"}
Bez backticks, bez markdown.`,
    messages: [{ role: "user", content: userMessage }],
  });

  const raw = res.content[0]?.text || "";
  try {
    return JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    // Fallback — użyj pierwszych 4 słów pytania
    return { query: userMessage.split(" ").slice(0, 4).join(" ") };
  }
}

// ── Claude: wybierz najlepsze źródła ──────────────────────────

async function selectBestSources(results, userMessage, model) {
  const res = await client.messages.create({
    model,
    max_tokens: 300,
    system: `Z listy wyników Google Search wybierz 5 NAJLEPSZYCH źródeł dla zapytania użytkownika.
Preferuj: oficjalne strony, blogi eksperckie, dokumentacje, artykuły naukowe, renomowane media.
Unikaj: forów, agregatów SEO, stron z małą ilością treści, Reddit (chyba że wątek jest super trafny).
Zwróć TYLKO JSON: {"selectedUrls": ["url1", "url2", ...], "reasoning": "krótko dlaczego te"}`,
    messages: [{
      role: "user",
      content: `Pytanie: ${userMessage}\n\nWyniki:\n${results.map((r, i) => `${i + 1}. [${r.displayLink}] ${r.title}\n   ${r.snippet}\n   URL: ${r.url}`).join("\n\n")}`,
    }],
  });

  const raw = res.content[0]?.text || "";
  try {
    return JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    // Fallback — weź 5 pierwszych
    return { selectedUrls: results.slice(0, 5).map((r) => r.url), reasoning: "fallback" };
  }
}

// ── Claude: oceń jakość źródeł i zdecyduj o re-search ────────

async function evaluateSources(scrapedSources, userMessage, model, searchRound, searchLang) {
  const sourceSummaries = scrapedSources
    .filter((s) => s.text && s.text.length > 50)
    .map((s, i) => `Źródło ${i + 1} (${s.url}):\n${s.text.slice(0, 1500)}`)
    .join("\n\n---\n\n");

  const res = await client.messages.create({
    model,
    max_tokens: 300,
    system: `Oceń zebrane źródła pod kątem zapytania użytkownika.

Obecna runda: ${searchRound}/3 (max 3 rundy)
Język wyszukiwania: ${searchLang}

Zdecyduj:
1. Czy źródła są WYSTARCZAJĄCE do udzielenia dobrej odpowiedzi?
2. Jeśli NIE — czy warto szukać pod INNYM hasłem lub W INNYM JĘZYKU?
   - Pamiętaj: źródła angielskie są CZĘSTO LEPSZE dla tematów technicznych, naukowych, biznesowych
   - Jeśli szukaliśmy po polsku i wyniki słabe → zaproponuj zapytanie po angielsku
   - Jeśli szukaliśmy po angielsku i wyniki słabe → zaproponuj bardziej precyzyjne hasło

Zwróć TYLKO JSON:
{
  "sufficient": true/false,
  "quality": "high/medium/low",
  "shouldResearch": false lub {"query": "nowe hasło", "language": "en/pl"},
  "reasoning": "dlaczego"
}`,
    messages: [{
      role: "user",
      content: `Pytanie: ${userMessage}\n\nZebrane źródła (${scrapedSources.filter(s => s.text).length} udanych):\n\n${sourceSummaries || "(brak treści)"}`,
    }],
  });

  const raw = res.content[0]?.text || "";
  try {
    return JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
  } catch {
    return { sufficient: true, quality: "medium", shouldResearch: false, reasoning: "parse error" };
  }
}

// ── Claude: final answer z źródłami ──────────────────────────

async function generateResearchAnswer(userMessage, allSources, model, history) {
  const sourceTexts = allSources
    .filter((s) => s.text && s.text.length > 50)
    .map((s, i) => `[${i + 1}] ${s.url}\n${s.text}`)
    .join("\n\n===\n\n");

  const sourceList = allSources
    .filter((s) => s.text && s.text.length > 50)
    .map((s, i) => `[${i + 1}] ${s.url}`);

  const messages = [];
  if (history?.length) {
    for (const msg of history.slice(-10)) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({
    role: "user",
    content: `${userMessage}\n\n---\nŹRÓDŁA DO WYKORZYSTANIA:\n\n${sourceTexts}`,
  });

  const res = await client.messages.create({
    model,
    max_tokens: 4096,
    system: `Jesteś asystentem Karola. Odpowiadasz ZAWSZE po polsku, na podstawie dostarczonych źródeł.

ZASADY:
- Udziel wyczerpującej, merytorycznej odpowiedzi
- W tekście umieszczaj PRZYPISY w formacie [1], [2], [3] itd. odnoszące się do numerów źródeł
- Na końcu dodaj sekcję "---SOURCES---" z listą wykorzystanych źródeł w formacie:
  [1] Tytuł lub krótki opis | URL
  [2] Tytuł lub krótki opis | URL
- Pisz naturalnie, ale opieraj się na faktach ze źródeł
- Jeśli źródła są sprzeczne, zaznacz to
- Nie wymyślaj informacji których nie ma w źródłach

AKTUALNY CZAS: ${new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}

FORMAT ODPOWIEDZI (WAŻNE — czysty JSON):
{
  "response": "treść odpowiedzi z przypisami [1], [2]...",
  "sources": [
    {"index": 1, "title": "Krótki tytuł", "url": "https://..."},
    {"index": 2, "title": "Krótki tytuł", "url": "https://..."}
  ],
  "thinking": "co zrozumiałem"
}`,
    messages,
  });

  const inputTokens = res.usage?.input_tokens || 0;
  const outputTokens = res.usage?.output_tokens || 0;
  const raw = res.content[0]?.text || "";

  try {
    const parsed = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    return { ...parsed, inputTokens, outputTokens };
  } catch {
    return {
      response: raw.slice(0, 3000),
      sources: sourceList.map((s, i) => ({ index: i + 1, title: s, url: s.split("] ")[1] || s })),
      thinking: "parse error",
      inputTokens,
      outputTokens,
    };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔍 Main research pipeline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Pełny pipeline researchu. Zwraca obiekt z postępem (callbacks).
 * onStatus(msg) — wywoływany na każdym etapie (do wyświetlenia spinnera)
 */
export async function runResearch(userMessage, model, history, onStatus) {
  const allSources = [];
  let searchLang = "pl";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let round = 1; round <= 3; round++) {
    // 1. Generuj zapytanie
    onStatus?.(`🔍 Runda ${round}: generuję zapytanie...`);
    const { query } = await generateSearchQuery(userMessage, model, searchLang);
    onStatus?.(`🔍 Runda ${round}: szukam "${query}" (${searchLang})...`);

    // 2. Google Search
    const results = await googleSearch(query);
    if (results.length === 0) {
      onStatus?.(`⚠️ Runda ${round}: brak wyników dla "${query}"`);
      if (searchLang === "pl") {
        searchLang = "en";
        continue;
      }
      break;
    }

    // 3. Claude wybiera 5 najlepszych
    onStatus?.(`📋 Runda ${round}: analizuję ${results.length} wyników...`);
    const { selectedUrls } = await selectBestSources(results, userMessage, model);

    // 4. Scrapuj wybrane
    onStatus?.(`📥 Runda ${round}: scrapuję ${selectedUrls.length} źródeł...`);
    const scraped = await scrapeMultiple(selectedUrls);
    const successful = scraped.filter((s) => s.text && s.text.length > 50);
    allSources.push(...successful);

    onStatus?.(`✅ Runda ${round}: zebrano ${successful.length} źródeł (łącznie ${allSources.length})`);

    // 5. Oceń jakość i zdecyduj o kolejnej rundzie
    if (round < 3) {
      onStatus?.(`🧠 Runda ${round}: oceniam jakość źródeł...`);
      const evaluation = await evaluateSources(scraped, userMessage, model, round, searchLang);

      if (evaluation.sufficient || !evaluation.shouldResearch) {
        onStatus?.(`✅ Źródła wystarczające (jakość: ${evaluation.quality})`);
        break;
      }

      // Re-search z nowym hasłem/językiem
      const nextSearch = evaluation.shouldResearch;
      searchLang = nextSearch.language || "en";
      onStatus?.(`🔄 Potrzebuję lepszych źródeł → szukam: "${nextSearch.query}" (${searchLang})`);

      // Override dla następnej rundy
      userMessage = `${userMessage}\n\n[Uwaga: szukaj pod hasłem: "${nextSearch.query}"]`;
    }
  }

  // 6. Generuj finalną odpowiedź
  onStatus?.(`✍️ Generuję odpowiedź na podstawie ${allSources.length} źródeł...`);
  const answer = await generateResearchAnswer(userMessage, allSources, model, history);

  return {
    response: answer.response,
    sources: answer.sources || [],
    thinking: answer.thinking || "",
    inputTokens: answer.inputTokens || 0,
    outputTokens: answer.outputTokens || 0,
    totalSourcesScraped: allSources.length,
  };
}
