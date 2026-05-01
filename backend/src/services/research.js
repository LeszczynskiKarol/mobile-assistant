import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;
const SCRAPER_URL = process.env.SCRAPER_URL;

// ── Limity ────────────────────────────────────────────────────
const MAX_CHARS_PER_SOURCE = 10000; // max znaków z jednego źródła
const MAX_TOTAL_CHARS = 100000; // max łączna treść do Claude
const MIN_SOURCE_CHARS = 300; // poniżej = śmieć, odrzuć
const MAX_ROUNDS = 2; // max 2 rundy (3 to za dużo)
const MAX_SOURCES_FINAL = 8; // max źródeł do finalnej odpowiedzi

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
  console.log(
    `✅ [SEARCH] ${results.length} wyników w ${Date.now() - start}ms`,
  );
  results.forEach((r, i) =>
    console.log(`   ${i + 1}. [${r.displayLink}] ${r.title.slice(0, 60)}`),
  );
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
      signal: AbortSignal.timeout(30_000), // 30s timeout per URL (było 120s!)
    });
    if (!res.ok) {
      console.error(`❌ [SCRAPE] ${url} → HTTP ${res.status}`);
      return { url, text: "", error: `Scraper ${res.status}` };
    }
    const data = await res.json();
    const text = (data.text || "").slice(0, MAX_CHARS_PER_SOURCE);
    const ms = Date.now() - start;

    if (text.length < MIN_SOURCE_CHARS) {
      console.log(
        `⚠️ [SCRAPE] ${url} → ${text.length} znaków (za mało, odrzucam) ${ms}ms`,
      );
      return { url, text: "", error: "too short" };
    }

    console.log(`✅ [SCRAPE] ${url} → ${text.length} znaków w ${ms}ms`);
    return { url, text, error: null };
  } catch (err) {
    console.error(
      `❌ [SCRAPE] ${url} → ${err.message} (${Date.now() - start}ms)`,
    );
    return { url, text: "", error: err.message };
  }
}

async function scrapeMultiple(urls, onStatus) {
  console.log(`📥 [SCRAPE] Scrapuję ${urls.length} URLi równolegle...`);
  const start = Date.now();
  const results = await Promise.all(
    urls.slice(0, 5).map((url) => {
      onStatus?.(`📥 Scrapuję: ${url.split("/")[2]}`);
      return scrapeUrl(url);
    }),
  );
  const ok = results.filter((s) => s.text.length >= MIN_SOURCE_CHARS);
  console.log(
    `📥 [SCRAPE] Gotowe: ${ok.length}/${results.length} udanych w ${Date.now() - start}ms`,
  );
  return results;
}

// ── Claude: czy potrzebny research? ──

export async function needsResearch(userMessage, model) {
  console.log(
    `🧠 [CLASSIFY] Sprawdzam czy "${userMessage.slice(0, 80)}" wymaga researchu...`,
  );
  const res = await client.messages.create({
    model,
    max_tokens: 200,
    system: `Oceń czy zapytanie wymaga aktualnych informacji z internetu.
Zwróć TYLKO: {"needsResearch": true/false, "reason": "krótko"}
Bez backticks, bez markdown, TYLKO JSON.

ZAWSZE false (NIE research) gdy zapytanie dotyczy:
- Trello: board, karta, lista, tablica, zadanie, checklist, przenieś, archiwizuj, stwórz board/kartę
- Gmail/email: poczta, mail, skrzynka, wyślij, odpowiedz, przeczytaj email, nieprzeczytane, draft
- Kontakty: kontakt, znajdź osobę, email kogoś, numer telefonu
- Google Drive: plik, dokument, folder, drive, co mam na dysku
- Kalendarz: wydarzenie, spotkanie, co mam w kalendarzu, dodaj do kalendarza
- Notatki/przypomnienia: zapisz, zanotuj, przypomnij
- Rozmowa: powitania, pytania osobiste, prośby o kod, analiza tekstu, tłumaczenie
- Polecenia do wykonania (cokolwiek z "zrób", "stwórz", "dodaj", "usuń", "przenieś", "wyślij", "sprawdź moją/moje")

TAK (research) TYLKO gdy:
- Aktualne wydarzenia, newsy, ceny, trendy
- Pytania o firmy, produkty, technologie wymagające aktualnych danych z internetu
- Porównania technologii, recenzje, statystyki
- Jawne "wyszukaj", "znajdź w internecie", "co nowego w..."`,
    messages: [{ role: "user", content: userMessage }],
  });
  const raw = res.content[0]?.text || "";
  try {
    const cleaned = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    console.log(
      `🧠 [CLASSIFY] → needsResearch: ${parsed.needsResearch} (${parsed.reason})`,
    );
    return parsed;
  } catch {
    const lower = userMessage.toLowerCase();
    const forceResearch =
      lower.includes("przeszukaj") ||
      lower.includes("wyszukaj") ||
      lower.includes("znajdź w internecie") ||
      lower.includes("search") ||
      lower.includes("sprawdź online") ||
      lower.includes("co nowego");
    console.log(`🧠 [CLASSIFY] → parse error, fallback: ${forceResearch}`);
    return { needsResearch: forceResearch, reason: "parse error fallback" };
  }
}

// ── Claude: generuj zapytanie do Google ──

async function generateSearchQuery(userMessage, model, language = "pl") {
  const res = await client.messages.create({
    model,
    max_tokens: 100,
    system: `Wygeneruj KRÓTKIE zapytanie do Google Search (2-4 słowa).
Język: ${language === "en" ? "ANGIELSKI" : "POLSKI"}.
Zwróć TYLKO: {"query": "zapytanie"}
Bez backticks, bez markdown, TYLKO JSON.`,
    messages: [{ role: "user", content: userMessage }],
  });

  const raw = res.content[0]?.text || "";
  try {
    return JSON.parse(
      raw
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim(),
    );
  } catch {
    const fallback = userMessage.split(" ").slice(0, 4).join(" ");
    console.log(`🔤 [QUERY] Parse error, fallback: "${fallback}"`);
    return { query: fallback };
  }
}

// ── Claude: wybierz najlepsze źródła ──

async function selectBestSources(results, userMessage, model) {
  console.log(`📋 [SELECT] Claude wybiera z ${results.length} wyników...`);

  // Numerowana lista — prostszy format, mniej parse errors
  const numbered = results
    .map((r, i) => `${i + 1}. ${r.title} | ${r.displayLink} | ${r.url}`)
    .join("\n");

  const res = await client.messages.create({
    model,
    max_tokens: 200,
    system: `Wybierz 5 NAJLEPSZYCH źródeł z listy wyników wyszukiwania.
Preferuj: oficjalne strony, dokumentacje, eksperckie blogi, renomowane media.
Unikaj: Reddit, forów, agregatów SEO, stron ze słabą treścią, Amazona.
Zwróć TYLKO JSON array z numerami: {"pick": [1, 3, 5, 7, 9]}
Bez backticks, bez markdown, TYLKO JSON.`,
    messages: [
      {
        role: "user",
        content: `Pytanie: ${userMessage}\n\nWyniki:\n${numbered}`,
      },
    ],
  });

  const raw = res.content[0]?.text || "";
  try {
    const parsed = JSON.parse(
      raw
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim(),
    );
    const picks = (parsed.pick || parsed.selectedUrls || []).slice(0, 5);

    // Jeśli numery (1-based)
    if (typeof picks[0] === "number") {
      const urls = picks.map((n) => results[n - 1]?.url).filter(Boolean);
      console.log(`📋 [SELECT] Wybrano ${urls.length} źródeł po numerach`);
      urls.forEach((u, i) => console.log(`   ${i + 1}. ${u}`));
      return { selectedUrls: urls };
    }

    // Jeśli URLe
    console.log(`📋 [SELECT] Wybrano ${picks.length} źródeł`);
    return { selectedUrls: picks };
  } catch {
    // Fallback — weź 5 pierwszych ale pomiń Reddit/Amazon
    const filtered = results
      .filter(
        (r) => !r.url.includes("reddit.com") && !r.url.includes("amazon.com"),
      )
      .slice(0, 5)
      .map((r) => r.url);
    console.log(
      `📋 [SELECT] Parse error, biorę ${filtered.length} (bez Reddit/Amazon)`,
    );
    return { selectedUrls: filtered };
  }
}

// ── Claude: oceń jakość źródeł ──

async function evaluateSources(
  scrapedSources,
  userMessage,
  model,
  searchRound,
  searchLang,
) {
  const successful = scrapedSources.filter(
    (s) => s.text.length >= MIN_SOURCE_CHARS,
  );
  console.log(
    `🧠 [EVAL] Runda ${searchRound}: oceniam ${successful.length} źródeł (język: ${searchLang})...`,
  );

  // Jeśli mamy 4+ dobrych źródeł — wystarczające, nie trać czasu
  if (successful.length >= 4) {
    console.log(
      `🧠 [EVAL] → ${successful.length} dobrych źródeł, wystarczające`,
    );
    return {
      sufficient: true,
      quality: "medium",
      shouldResearch: false,
      reasoning: "enough sources",
    };
  }

  const sourceSummaries = successful
    .map((s, i) => `Źródło ${i + 1} (${s.url}):\n${s.text.slice(0, 800)}`)
    .join("\n---\n");

  const res = await client.messages.create({
    model,
    max_tokens: 200,
    system: `Oceń źródła. Runda: ${searchRound}/${MAX_ROUNDS}, język: ${searchLang}.
Czy wystarczające? Jeśli nie i szukaliśmy po polsku → zaproponuj angielskie hasło.
Zwróć TYLKO JSON:
{"sufficient": true/false, "quality": "high/medium/low", "shouldResearch": false, "reasoning": "krótko"}
lub jeśli trzeba szukać dalej:
{"sufficient": false, "quality": "low", "shouldResearch": {"query": "new query", "language": "en"}, "reasoning": "krótko"}
Bez backticks, TYLKO JSON.`,
    messages: [
      {
        role: "user",
        content: `Pytanie: ${userMessage}\n\n${sourceSummaries || "(brak)"}`,
      },
    ],
  });

  const raw = res.content[0]?.text || "";
  try {
    const parsed = JSON.parse(
      raw
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim(),
    );
    console.log(
      `🧠 [EVAL] → sufficient: ${parsed.sufficient}, quality: ${parsed.quality}`,
    );
    if (parsed.shouldResearch) {
      console.log(
        `🧠 [EVAL] → kolejna runda: "${parsed.shouldResearch.query}" (${parsed.shouldResearch.language})`,
      );
    }
    return parsed;
  } catch {
    console.log(`🧠 [EVAL] Parse error, zakładam sufficient`);
    return {
      sufficient: true,
      quality: "medium",
      shouldResearch: false,
      reasoning: "parse error",
    };
  }
}

// ── Claude: finalna odpowiedź ──

async function generateResearchAnswer(userMessage, allSources, model, history) {
  // Deduplikacja po URL
  const seen = new Set();
  const unique = allSources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return s.text.length >= MIN_SOURCE_CHARS;
  });

  // Ogranicz ilość i łączną długość
  let totalChars = 0;
  const limited = [];
  for (const s of unique) {
    if (limited.length >= MAX_SOURCES_FINAL) break;
    if (totalChars + s.text.length > MAX_TOTAL_CHARS) {
      // Przytnij ostatnie źródło do limitu
      const remaining = MAX_TOTAL_CHARS - totalChars;
      if (remaining > MIN_SOURCE_CHARS) {
        limited.push({ ...s, text: s.text.slice(0, remaining) });
      }
      break;
    }
    totalChars += s.text.length;
    limited.push(s);
  }

  console.log(
    `✍️ [ANSWER] ${unique.length} unikalnych → ${limited.length} po limicie (${totalChars} znaków), model: ${model}`,
  );

  const sourceTexts = limited
    .map((s, i) => `[${i + 1}] ${s.url}\n${s.text}`)
    .join("\n\n===\n\n");

  const messages = [];
  if (history?.length) {
    for (const msg of history.slice(-10)) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({
    role: "user",
    content: `${userMessage}\n\n---\nŹRÓDŁA:\n\n${sourceTexts}`,
  });

  const start = Date.now();
  const maxTokens = 8192;

  let response = await client.messages.create({
    model,
    max_tokens: maxTokens,

    system: `Jesteś asystentem. Odpowiadaj po polsku na podstawie źródeł.
W tekście umieszczaj przypisy [1], [2] itd.
WAŻNE: Pisz WYŁĄCZNIE ciągłą prozą w akapitach. NIGDY nie używaj list numerowanych (1. 2. 3.), punktorów (- •) ani wypunktowań. Odpowiedź będzie czytana na głos — listy są niedopuszczalne.
Zwróć TYLKO JSON:
{
  "response": "treść z przypisami [1] [2]...",
  "sources": [{"index": 1, "title": "Tytuł", "url": "https://..."}],
  "thinking": "krótko"
}
Bez backticks, TYLKO JSON.

CZAS: ${new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}`,
    messages,
  });

  let raw = response.content[0]?.text || "";
  let inputTokens = response.usage?.input_tokens || 0;
  let outputTokens = response.usage?.output_tokens || 0;

  // Auto-kontynuacja
  let retries = 0;
  while (response.stop_reason === "max_tokens" && retries < 3) {
    retries++;
    console.log(`🔄 [ANSWER] Kontynuacja #${retries}`);

    response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: `Kontynuuj odpowiedź. Zwróć TYLKO kontynuację tekstu JSON, bez powtarzania tego co już jest.`,
      messages: [
        ...messages,
        { role: "assistant", content: raw },
        {
          role: "user",
          content: "Kontynuuj od miejsca przerwania. Dokończ JSON.",
        },
      ],
    });

    raw += response.content[0]?.text || "";
    inputTokens += response.usage?.input_tokens || 0;
    outputTokens += response.usage?.output_tokens || 0;
  }

  console.log(
    `✍️ [ANSWER] Gotowe w ${Date.now() - start}ms (${inputTokens} in + ${outputTokens} out)`,
  );

  try {
    const parsed = JSON.parse(
      raw
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim(),
    );

    // Renumeruj źródła na sekwencyjne 1, 2, 3...
    if (parsed.sources) {
      parsed.sources = parsed.sources.map((s, i) => ({
        ...s,
        index: i + 1,
      }));
    }

    return { ...parsed, inputTokens, outputTokens };
  } catch {
    console.error(`❌ [ANSWER] Parse error`);
    return {
      response: raw.slice(0, 3000),
      sources: limited.map((s, i) => ({
        index: i + 1,
        title: s.url.split("/")[2],
        url: s.url,
      })),
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
  console.log(`🔬 [RESEARCH] START: "${userMessage.slice(0, 100)}" (${model})`);
  console.log(`${"═".repeat(60)}`);

  const allSources = [];
  const seenUrls = new Set();
  let searchLang = "pl";
  let lastQuery = "";

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`\n── Runda ${round}/${MAX_ROUNDS} (${searchLang}) ──`);

    onStatus?.(`🔍 Runda ${round}: generuję zapytanie...`);
    const { query } = await generateSearchQuery(userMessage, model, searchLang);

    // Nie szukaj tego samego
    if (query === lastQuery) {
      console.log(
        `⚠️ [RESEARCH] Identyczne zapytanie "${query}", pomijam rundę`,
      );
      break;
    }
    lastQuery = query;

    onStatus?.(`🔍 Runda ${round}: szukam "${query}" (${searchLang})...`);
    const results = await googleSearch(query);
    if (results.length === 0) {
      console.log(`⚠️ [RESEARCH] Brak wyników`);
      onStatus?.(`⚠️ Brak wyników dla "${query}"`);
      if (searchLang === "pl") {
        searchLang = "en";
        continue;
      }
      break;
    }

    onStatus?.(`📋 Runda ${round}: wybieram źródła...`);
    const { selectedUrls } = await selectBestSources(
      results,
      userMessage,
      model,
    );

    // Deduplikacja — nie scrapuj URLi które już mamy
    const newUrls = selectedUrls.filter((u) => !seenUrls.has(u));
    newUrls.forEach((u) => seenUrls.add(u));

    if (newUrls.length === 0) {
      console.log(`⚠️ [RESEARCH] Wszystkie URLe już zescrapowane, kończę`);
      break;
    }

    onStatus?.(`📥 Runda ${round}: scrapuję ${newUrls.length} źródeł...`);
    const scraped = await scrapeMultiple(newUrls, onStatus);
    const successful = scraped.filter((s) => s.text.length >= MIN_SOURCE_CHARS);
    allSources.push(...successful);

    onStatus?.(
      `✅ Runda ${round}: ${successful.length} nowych źródeł (łącznie ${allSources.length})`,
    );

    // Oceń czy potrzebna kolejna runda
    if (round < MAX_ROUNDS) {
      onStatus?.(`🧠 Oceniam źródła...`);
      const evaluation = await evaluateSources(
        scraped,
        userMessage,
        model,
        round,
        searchLang,
      );

      if (evaluation.sufficient || !evaluation.shouldResearch) {
        console.log(`✅ [RESEARCH] Wystarczające po rundzie ${round}`);
        break;
      }

      const next = evaluation.shouldResearch;
      searchLang = next.language || "en";
      onStatus?.(`🔄 Szukam dalej: "${next.query}" (${searchLang})`);
      userMessage = `${userMessage}\n\n[Szukaj: "${next.query}"]`;
    }
  }

  // Finalna odpowiedź
  onStatus?.(`✍️ Generuję odpowiedź z ${allSources.length} źródeł...`);
  const answer = await generateResearchAnswer(
    userMessage,
    allSources,
    model,
    history,
  );

  const totalMs = Date.now() - pipelineStart;
  console.log(`\n${"═".repeat(60)}`);
  console.log(
    `🔬 [RESEARCH] KONIEC w ${totalMs}ms | ${allSources.length} źródeł | ${answer.response?.length || 0} znaków`,
  );
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
