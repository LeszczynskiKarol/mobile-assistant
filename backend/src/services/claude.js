import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

function fixCodeBlocks(text) {
  if (text.includes("```")) return text;
  const langPatterns =
    /\b(python|javascript|typescript|bash|sql|html|css|json|yaml|sh|jsx|tsx|nginx|prisma)\n([\s\S]*?)(?=\n\n[A-ZĄĆĘŁŃÓŚŹŻ]|\n\n$|$)/gi;
  return text.replace(langPatterns, (match, lang, code) => {
    const lines = code.trim().split("\n");
    const looksLikeCode = lines.some(
      (l) =>
        /^\s{2,}/.test(l) ||
        /^(def |class |import |from |const |let |var |function |if |for |while |return |print|console\.)/.test(
          l.trim(),
        ),
    );
    if (!looksLikeCode || lines.length < 2) return match;
    return "```" + lang.toLowerCase() + "\n" + code.trimEnd() + "\n```";
  });
}

const PRICING = {
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
};

export function calculateCost(model, inputTokens, outputTokens) {
  const prices = PRICING[model] || PRICING["claude-haiku-4-5"];
  return (
    (inputTokens / 1_000_000) * prices.input +
    (outputTokens / 1_000_000) * prices.output
  );
}

const SYSTEM_PROMPT = `Jesteś wszechstronnym asystentem AI. Pomagasz we WSZYSTKIM: pisaniu kodu, odpowiadaniu na pytania, analizie, tworzeniu treści, a także zarządzaniu zadaniami przez akcje (Trello, Gmail, Calendar). Jeśli pytanie wymaga akcji — zwróć je w tablicy actions. Jeśli pytanie to rozmowa, kod, analiza — odpowiedz merytorycznie w polu response, z pustą tablicą actions.

DOSTĘPNE AKCJE:

── TRELLO — ODCZYT ──
1. trello_boards — lista boardów użytkownika
   params: {} (brak)
2. trello_board — przegląd boardu: wszystkie listy z kartami
   params: { boardId?: string (domyślnie główny board) }
3. trello_list_cards — karty na konkretnej liście
   params: { listId?: string, listName?: string }
4. trello_get_card — szczegóły karty (opis, checklista, komentarze)
   params: { cardId: string }
5. trello_search — wyszukaj karty po tekście
   params: { query: string, boardId?: string }

── TRELLO — ZAPIS ──
6. trello_create_card — tworzenie karty w Trello
   params: { title: string, description?: string, listId?: string, labels?: string[], due?: string }
7. trello_move_card — przeniesienie karty
   params: { cardName?: string, cardId?: string, targetList: string }
8. trello_comment — dodaj komentarz do karty
   params: { cardId?: string, cardName?: string, text: string }
9. trello_archive — archiwizuj kartę
   params: { cardId?: string, cardName?: string }

── GMAIL — WYSYŁANIE ──
10. gmail_send — wysłanie emaila
   params: { to: string, subject: string, body: string, cc?: string, htmlBody?: string }
11. gmail_draft — utworzenie draftu emaila
   params: { to: string, subject: string, body: string, cc?: string, htmlBody?: string }
12. gmail_reply — odpowiedź na email (wymaga messageId z gmail_list lub gmail_read)
   params: { messageId: string, body: string, replyAll?: boolean }
13. gmail_forward — prześlij email dalej
   params: { messageId: string, to: string, comment?: string }

── GMAIL — ODCZYT ──
14. gmail_list — lista emaili (inbox, nieprzeczytane, wysłane, itp.)
   params: { query?: string, maxResults?: number (domyślnie 10), label?: string (INBOX|SENT|DRAFT|STARRED|SPAM|TRASH|UNREAD), pageToken?: string }
15. gmail_read — przeczytaj pełną treść emaila
   params: { messageId: string, markAsRead?: boolean (domyślnie true) }
16. gmail_search — wyszukaj emaile (Gmail search syntax: "from:jan subject:raport after:2025/01/01 has:attachment")
   params: { query: string, maxResults?: number }
17. gmail_thread — pobierz cały wątek emailowy
    params: { threadId: string, maxResults?: number }

── GMAIL — ORGANIZACJA ──
18. gmail_trash — przenieś email do kosza
    params: { messageId: string }
19. gmail_untrash — przywróć email z kosza
    params: { messageId: string }
20. gmail_mark_read — oznacz jako przeczytany/nieprzeczytany
    params: { messageId: string, read?: boolean (domyślnie true) }
21. gmail_star — oznacz/odznacz gwiazdkę
    params: { messageId: string, starred?: boolean (domyślnie true) }
22. gmail_labels — pobierz listę etykiet Gmail
    params: {} (brak)
23. gmail_modify_labels — dodaj/usuń etykiety z emaila
    params: { messageId: string, addLabels?: string[], removeLabels?: string[] }
24. gmail_batch_modify — zbiorcza operacja na wielu emailach
    params: { messageIds: string[], addLabels?: string[], removeLabels?: string[] }
25. gmail_profile — informacje o koncie Gmail
    params: {} (brak)

── KALENDARZ ──
26. calendar_create — utworzenie wydarzenia w kalendarzu
    params: { title: string, date: string (ISO), duration?: number (minuty), description?: string }
27. calendar_list — lista nadchodzących wydarzeń
    params: { days?: number }

── NOTATKI ──
28. reminder — ustawienie przypomnienia
    params: { text: string, date: string (ISO) }
29. note — zapisanie notatki
    params: { text: string, tags?: string[] }

TRELLO WORKFLOW:
- "pokaż mój board" / "co jest na tablicy" → trello_board (bez boardId = domyślny board)
- "jakie mam boardy" → trello_boards
- "co jest na liście Do zrobienia" → trello_list_cards z listName: "Do zrobienia"
- "pokaż kartę X" / "szczegóły karty" → trello_get_card (wymaga cardId — podawaj je w odpowiedziach!)
- "szukaj karty o bug" → trello_search z query
- "dodaj komentarz do karty X" → trello_comment
- "archiwizuj kartę X" → trello_archive
- ZAWSZE podawaj cardId w wynikach — user potrzebuje go do dalszych operacji

GMAIL WORKFLOW:
- Gdy użytkownik pyta "co mam w mailu" / "pokaż emaile" / "sprawdź pocztę" → użyj gmail_list
- Gdy pyta "pokaż nieprzeczytane" → gmail_list z label: "UNREAD"
- Gdy pyta "przeczytaj ten email" / podaje ID → gmail_read
- Gdy pyta "szukaj emaili od X" → gmail_search z query
- Gdy pyta "odpowiedz na ten email" → NAJPIERW musisz mieć messageId (z wcześniejszego gmail_list/gmail_read), potem gmail_reply
- Gdy pyta "prześlij to do Y" → gmail_forward
- Wieloetapowy flow: jeśli user powie "odpowiedz na ostatniego maila od Jana" — użyj DWÓCH akcji: 1) gmail_search aby znaleźć email, 2) zapisz info w response że znalazłeś email i podaj jego treść, zapytaj co odpowiedzieć
- Dla operacji zbiorczych (np. "oznacz wszystkie jako przeczytane") → gmail_batch_modify
- ZAWSZE prezentuj wyniki gmail_list w czytelny sposób: od kogo, temat, data, czy przeczytany

ZASADY:
- Odpowiadaj ZAWSZE po polsku
- Zwracaj TYLKO valid JSON, bez markdown wokół JSON, bez backticks otaczających JSON
- Jeśli polecenie wymaga wielu akcji, zwróć tablicę actions
- Jeśli polecenie to pytanie lub rozmowa, zwróć pustą tablicę actions
- Pole "thinking" to krótkie wyjaśnienie co zrozumiałeś (do debugowania)
- Jeśli brakuje informacji do wykonania akcji, zapytaj w "response" i ustaw "needsInput": true
- Daty relatywne (jutro, za godzinę, w piątek) rozwiązuj względem TERAZ

FORMATOWANIE ODPOWIEDZI W POLU "response":
- Dla ROZMOWY i WYJAŚNIEŃ: pisz ciągłą prozą w akapitach, bez list numerowanych, bez punktorów
- Dla KODU: otaczaj bloki kodu markerami [CODE:język] i [/CODE]. Przykład:
  "response": "Oto skrypt:\n\n[CODE:python]\ndef hello():\n    print('Hello')\n\nhello()\n[/CODE]\n\nUruchom komendą [INLINE]python hello.py[/INLINE]."
- NIGDY nie używaj potrójnych backticków w response — ZAWSZE [CODE:język]...[/CODE]
- Dla inline kodu: [INLINE]nazwaZmiennej[/INLINE]
- Każdy kod MUSI być w [CODE:język]...[/CODE], nigdy luźno
- Możesz MIESZAĆ prozę z blokami kodu

FORMATOWANIE EMAILI W RESPONSE:
- Gdy prezentujesz listę emaili, formatuj je czytelnie:
  📩 Od: Jan Kowalski <jan@test.pl>
  📌 Temat: Spotkanie w piątek
  📅 Data: 28 kwi 2026, 14:30
  ✉️ Status: nieprzeczytany ⭐
  ID: abc123def
  ---
- Podawaj ZAWSZE ID emaila — user potrzebuje go do reply/forward/trash

AKTUALNY CZAS: {{CURRENT_TIME}}

FORMAT ODPOWIEDZI:
{
  "thinking": "krótko co zrozumiałem",
  "response": "tekst do odczytania na głos",
  "actions": [
    { "action": "nazwa_akcji", "params": { ... } }
  ],
  "needsInput": false
}`;

const MODEL_LIMITS = {
  "claude-haiku-4-5": 8192,
  "claude-sonnet-4-6": 16384,
};

export async function interpretIntent(text, opts = {}) {
  const { context, history, model = "claude-haiku-4-5" } = opts;
  const startTime = Date.now();
  const maxTokens = MODEL_LIMITS[model] || 64000;

  const now = new Date().toLocaleString("pl-PL", {
    timeZone: "Europe/Warsaw",
    dateStyle: "full",
    timeStyle: "short",
  });

  const systemPrompt = SYSTEM_PROMPT.replace("{{CURRENT_TIME}}", now);
  const messages = [];

  if (history?.length) {
    for (const msg of history.slice(-20)) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  let userContent = text;
  if (context) {
    userContent += `\n\n[Kontekst: ${JSON.stringify(context)}]`;
  }
  messages.push({ role: "user", content: userContent });

  // Pierwsza odpowiedź
  let response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  let raw = response.content[0]?.text || "";
  let totalInput = response.usage?.input_tokens || 0;
  let totalOutput = response.usage?.output_tokens || 0;

  // Auto-kontynuacja jeśli Claude nie skończył
  let retries = 0;
  while (response.stop_reason === "max_tokens" && retries < 3) {
    retries++;
    console.log(
      `🔄 [CLAUDE] Kontynuacja #${retries} (stop_reason: max_tokens, dotychczas ${raw.length} znaków)`,
    );

    const contMessages = [
      ...messages,
      { role: "assistant", content: raw },
      {
        role: "user",
        content:
          "Kontynuuj dokładnie od miejsca w którym przerwałeś. Nie powtarzaj tego co już napisałeś. Nie dodawaj żadnego wstępu. Kontynuuj od następnego znaku.",
      },
    ];

    response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: contMessages,
    });

    const continuation = response.content[0]?.text || "";
    raw += continuation;
    totalInput += response.usage?.input_tokens || 0;
    totalOutput += response.usage?.output_tokens || 0;

    console.log(
      `🔄 [CLAUDE] Kontynuacja #${retries}: +${continuation.length} znaków (łącznie ${raw.length})`,
    );
  }

  const latencyMs = Date.now() - startTime;
  const costUsd = calculateCost(model, totalInput, totalOutput);

  const stats = {
    inputTokens: totalInput,
    outputTokens: totalOutput,
    totalTokens: totalInput + totalOutput,
    costUsd,
    model,
    latencyMs,
  };

  const result = parseClaudeResponse(raw);
  return { ...result, ...stats };
}

function parseClaudeResponse(raw) {
  console.log("📦 [RAW CLAUDE]:", raw.slice(0, 500));

  // Próba 1: normalny JSON parse
  try {
    const cleaned = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    return {
      response: convertCodeMarkers(parsed.response || ""),
      actions: parsed.actions || [],
      thinking: parsed.thinking || "",
      needsInput: parsed.needsInput || false,
    };
  } catch {}

  // Próba 2: JSON złamany przez backticki — wyciągnij pola regexem
  const thinkingMatch = raw.match(/"thinking"\s*:\s*"([^"]*)"/);
  const needsInputMatch = raw.match(/"needsInput"\s*:\s*(true|false)/);

  const responseStart = raw.indexOf('"response"');
  if (responseStart !== -1) {
    const valStart = raw.indexOf('"', responseStart + 10) + 1;
    if (valStart > 0) {
      let valEnd = -1;
      for (const marker of ['"actions"', '"thinking"', '"needsInput"']) {
        const idx = raw.indexOf(marker, valStart);
        if (idx !== -1) {
          const sub = raw.substring(valStart, idx);
          const lastQuote = sub.lastIndexOf('"');
          if (
            lastQuote !== -1 &&
            (valEnd === -1 || valStart + lastQuote < valEnd)
          ) {
            valEnd = valStart + lastQuote;
          }
        }
      }
      if (valEnd === -1) {
        valEnd = raw.lastIndexOf('"');
      }

      if (valEnd > valStart) {
        let text = raw.substring(valStart, valEnd);
        text = text
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");

        return {
          response: convertCodeMarkers(text),
          actions: [],
          thinking: thinkingMatch ? thinkingMatch[1] : "",
          needsInput: needsInputMatch ? needsInputMatch[1] === "true" : false,
        };
      }
    }
  }

  // Próba 3: cały raw jako response
  return {
    response: convertCodeMarkers(raw),
    actions: [],
    thinking: "Fallback parser",
    needsInput: false,
  };
}

function convertCodeMarkers(text) {
  if (!text) return text;
  text = text.replace(/\[CODE:(\w+)\]\n?/g, "```$1\n");
  text = text.replace(/\n?\[\/CODE\]/g, "\n```");
  text = text.replace(/\[INLINE\](.*?)\[\/INLINE\]/g, "`$1`");
  return text;
}

export async function generateTopic(firstUserMessage) {
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 60,
      system:
        "Wygeneruj ULTRA krótki temat konwersacji (3-6 słów, po polsku) na podstawie pierwszej wiadomości użytkownika. Zwróć TYLKO temat, nic więcej. Bez cudzysłowów, bez kropki na końcu.",
      messages: [{ role: "user", content: firstUserMessage }],
    });
    return (response.content[0]?.text || "Nowa konwersacja").trim();
  } catch {
    return "Nowa konwersacja";
  }
}

/**
 * Second-pass: Claude podsumowuje wyniki akcji odczytowych
 */
export async function summarizeActionResults(
  userQuery,
  actionResults,
  model = "claude-haiku-4-5",
) {
  const maxTokens = MODEL_LIMITS[model] || 8192;

  // Przygotuj dane z wyników akcji (ogranicz rozmiar)
  const resultsText = actionResults
    .map((a) => {
      const data = JSON.stringify(a.result, null, 2);
      const truncated =
        data.length > 6000 ? data.slice(0, 6000) + "\n... (obcięto)" : data;
      return `Wynik akcji "${a.action}" (params: ${JSON.stringify(a.params)}):\n${truncated}`;
    })
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: `Jesteś asystentem AI który prezentuje użytkownikowi wyniki zapytań. Otrzymujesz surowe dane z API (Gmail, Trello, Kalendarz itp.) i Twoim zadaniem jest przedstawić je w czytelny, naturalny sposób po polsku.

ZASADY PREZENTACJI:
- Pisz naturalnie, jakbyś opowiadał znajomemu co znalazłeś
- ZAWSZE podawaj ID obiektów (email ID, card ID) — user potrzebuje ich do dalszych operacji

DLA EMAILI:
  📩 Od: [nadawca]
  📌 Temat: [temat]  
  📅 [data]
  ✉️ [status: przeczytany/nieprzeczytany] [⭐ jeśli oznaczony]
  ID: [id]
  ---
- Na końcu krótkie podsumowanie

DLA TRELLO:
- Board: nazwa, ile list, ile kart łącznie
- Listy: prezentuj jako sekcje z kartami pod spodem
- Karty: nazwa, etykiety (kolorowe), deadline (jeśli jest), przypisani
- Format:
  📋 Lista: [nazwa] ([X] kart)
  ├─ 🟢 [nazwa karty] — [etykiety] [📅 deadline] [👤 przypisany]
  ├─ 🔴 [nazwa karty] ...
  └─ [nazwa karty]
- Checklista: pokaż postęp (np. 3/5 zrobione)
- Komentarze: pokaż ostatnie 2-3

DLA KALENDARZA:
- Wydarzenia chronologicznie z godziną i tytułem

- Jeśli brak wyników — powiedz to wprost
- NIE zwracaj JSON — zwróć TYLKO tekst do wyświetlenia`,
    messages: [
      {
        role: "user",
        content: `Moje pytanie: "${userQuery}"\n\nOto surowe wyniki:\n\n${resultsText}\n\nPrzedstaw mi te wyniki w czytelny sposób.`,
      },
    ],
  });

  const text =
    response.content[0]?.text || "Nie udało się przetworzyć wyników.";

  return {
    response: text,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
  };
}
