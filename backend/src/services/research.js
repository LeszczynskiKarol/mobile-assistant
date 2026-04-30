import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;
const SCRAPER_URL = process.env.SCRAPER_URL;

// ── Google Custom Search ──

async function googleSearch(query) {
  console.log(`🔍 [SEARCH] Google query: "${query}"`);
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", GOOGLE_API_KEY);
  url.searchParams.set("cx", GOOGLE_CX);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "10");

  const start = Date.now();
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.text();
    console.error(`❌ [SEARCH] Google API error ${res.status}: ${err}`);
    throw new Error(`Google Search ${res.status}: ${err}`);
  }
  const data = await res.json();
  const results = (data.items || []).map((item) => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet || "",
    displayLink: item.displayLink,
  }));
  console.log(`✅ [SEARCH] ${results.length} wyników w ${Date.now() - start}ms`);
  results.forEach((r, i) => console.log(`   ${i + 1}. [${r.displayLink}] ${r.title.slice(0, 60)}`));
  return results;
}

// ── Scraper ──

async function scrapeUrl(url) {
  console.log(`📥 [SCRAPE] Start: ${url}`);
  const start = Date.now();
  try {
    const res = await fetch(`${SCRAPER_URL}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      console.error(`❌ [SCRAPE] ${url} → HTTP ${res.status}`);
      return { url, text: "", error: `Scraper ${res.status}` };
    }
    const data = await res.json();
    const text = (data.text || "").slice(0, 8000);
    console.log(`✅ [SCRAPE] ${url} → ${text.length} znaków w ${Date.now() - start}ms`);
    return { url, text, error: null };
  } catch (err) {
    console.error(`❌ [SCRAPE] ${url} → ${err.message} (${Date.now() - start}ms)`);
    return { url, text: "", error: err.message };
  }
}

async function scrapeMultiple(urls) {
  console.log(`📥 [SCRAPE] Scrapuję ${urls.length} URLi równolegle...`);
  const start = Date.now();
  const results = await Promise.all(urls.slice(0, 5).map(scrapeUrl));
  const ok = results.filter((s) => s.text && s.text.length > 50).length;
  console.log(`📥 [SCRAPE] Gotowe: ${ok}/${results.length} udanych w ${Date.now() - start}ms`);
  return results;
}

// ── Claude: czy potrzebny research? ──

export async function needsResearch(userMessage, model) {
  console.log(`🧠 [CLASSIFY] Sprawdzam czy "${userMessage.slice(0, 80)}" wymaga researchu...`);
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
    const parsed = JSON.parse(cleaned);
    console.log(`🧠 [CLASSIFY] → needsResearch: ${parsed.needsResearch} (${parsed.reason})`);
    return parsed;
  } catch {
    console.log(`🧠 [CLASSIFY] → parse error, domyślnie false`);
    return { needsResearch: false, reason: "parse error" };
  }
}

// ── Claude: generuj zapytanie do Google ──

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
    const parsed = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    console.log(`🔤 [QUERY] Claude wygenerował: "${parsed.query}" (${language})`);
    return parsed;
  } catch {
    const fallback = userMessage.split(" ").slice(0, 4).join(" ");
    console.log(`🔤 [QUERY] Parse error, fallback: "${fallback}"`);
    return { query: fallback };
  }
}

// ── Claude: wybierz najlepsze źródła ──

async function selectBestSources(results, userMessage, model) {
  console.log(`📋 [SELECT] Claude wybiera najlepsze źródła z ${results.length} wyników...`);
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
    const parsed = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    console.log(`📋 [SELECT] Wybrano ${parsed.selectedUrls.length} źródeł: ${parsed.reasoning}`);
    parsed.selectedUrls.forEach((u, i) => console.log(`   ${i + 1}. ${u}`));
    return parsed;
  } catch {
    console.log(`📋 [SELECT] Parse error, biorę 5 pierwszych`);
    return { selectedUrls: results.slice(0, 5).map((r) => r.url), reasoning: "fallback" };
  }
}

// ── Claude: oceń jakość źródeł ──

async function evaluateSources(scrapedSources, userMessage, model, searchRound, searchLang) {
  const successful = scrapedSources.filter((s) => s.text && s.text.length > 50);
  console.log(`🧠 [EVAL] Runda ${searchRound}: oceniam ${successful.length} źródeł (język: ${searchLang})...`);

  const sourceSummaries = successful
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
      content: `Pytanie: ${userMessage}\n\nZebrane źródła (${successful.length} udanych):\n\n${sourceSummaries || "(brak treści)"}`,
    }],
  });

  const raw = res.content[0]?.text || "";
  try {
    const parsed = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    console.log(`🧠 [EVAL] → sufficient: ${parsed.sufficient}, quality: ${parsed.quality}`);
    if (parsed.shouldResearch) {
      console.log(`🧠 [EVAL] → kolejna runda: "${parsed.shouldResearch.query}" (${parsed.shouldResearch.language})`);
    }
    return parsed;
  } catch {
    console.log(`🧠 [EVAL] Parse error, zakładam sufficient`);
    return { sufficient: true, quality: "medium", shouldResearch: false, reasoning: "parse error" };
  }
}

// ── Claude: finalna odpowiedź ──

async function generateResearchAnswer(userMessage, allSources, model, history) {
  const successful = allSources.filter((s) => s.text && s.text.length > 50);
  console.log(`✍️ [ANSWER] Generuję odpowiedź z ${successful.length} źródeł (model: ${model})...`);

  const sourceTexts = successful
    .map((s, i) => `[${i + 1}] ${s.url}\n${s.text}`)
    .join("\n\n===\n\n");

  const sourceList = successful.map((s, i) => `[${i + 1}] ${s.url}`);

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

  const start = Date.now();
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

  console.log(`✍️ [ANSWER] Gotowe w ${Date.now() - start}ms (${inputTokens} in + ${outputTokens} out tokens)`);

  try {
    const parsed = JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    return { ...parsed, inputTokens, outputTokens };
  } catch {
    console.error(`❌ [ANSWER] Parse error, zwracam raw text`);
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

export async function runResearch(userMessage, model, history, onStatus) {
  const pipelineStart = Date.now();
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🔬 [RESEARCH] START pipeline dla: "${userMessage.slice(0, 100)}"`);
  console.log(`   Model: ${model}`);
  console.log(`${"═".repeat(60)}`);

  const allSources = [];
  let searchLang = "pl";

  for (let round = 1; round <= 3; round++) {
    console.log(`\n── Runda ${round}/3 (${searchLang}) ──`);

    onStatus?.(`🔍 Runda ${round}: generuję zapytanie...`);
    const { query } = await generateSearchQuery(userMessage, model, searchLang);
    onStatus?.(`🔍 Runda ${round}: szukam "${query}" (${searchLang})...`);

    const results = await googleSearch(query);
    if (results.length === 0) {
      console.log(`⚠️ [RESEARCH] Brak wyników, zmieniam język`);
      onStatus?.(`⚠️ Runda ${round}: brak wyników dla "${query}"`);
      if (searchLang === "pl") { searchLang = "en"; continue; }
      break;
    }

    onStatus?.(`📋 Runda ${round}: analizuję ${results.length} wyników...`);
    const { selectedUrls } = await selectBestSources(results, userMessage, model);

    onStatus?.(`📥 Runda ${round}: scrapuję ${selectedUrls.length} źródeł...`);
    const scraped = await scrapeMultiple(selectedUrls);
    const successful = scraped.filter((s) => s.text && s.text.length > 50);
    allSources.push(...successful);

    onStatus?.(`✅ Runda ${round}: zebrano ${successful.length} źródeł (łącznie ${allSources.length})`);

    if (round < 3) {
      onStatus?.(`🧠 Runda ${round}: oceniam jakość źródeł...`);
      const evaluation = await evaluateSources(scraped, userMessage, model, round, searchLang);

      if (evaluation.sufficient || !evaluation.shouldResearch) {
        console.log(`✅ [RESEARCH] Źródła wystarczające po rundzie ${round}`);
        onStatus?.(`✅ Źródła wystarczające (jakość: ${evaluation.quality})`);
        break;
      }

      const nextSearch = evaluation.shouldResearch;
      searchLang = nextSearch.language || "en";
      onStatus?.(`🔄 Potrzebuję lepszych źródeł → szukam: "${nextSearch.query}" (${searchLang})`);
      userMessage = `${userMessage}\n\n[Uwaga: szukaj pod hasłem: "${nextSearch.query}"]`;
    }
  }

  onStatus?.(`✍️ Generuję odpowiedź na podstawie ${allSources.length} źródeł...`);
  const answer = await generateResearchAnswer(userMessage, allSources, model, history);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🔬 [RESEARCH] KONIEC pipeline w ${Date.now() - pipelineStart}ms`);
  console.log(`   Źródeł: ${allSources.length}, Odpowiedź: ${answer.response?.length || 0} znaków`);
  console.log(`${"═".repeat(60)}\n`);

  return {
    response: answer.response,
    sources: answer.sources || [],
    thinking: answer.thinking || "",
    inputTokens: answer.inputTokens || 0,
    outputTokens: answer.outputTokens || 0,
    totalSourcesScraped: allSources.length,
  };
}
