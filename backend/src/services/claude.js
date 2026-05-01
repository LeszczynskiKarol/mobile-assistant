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

── TRELLO ──
1. trello_create_card — tworzenie karty w Trello
   params: { title: string, description?: string, listId?: string, labels?: string[] }
2. trello_move_card — przeniesienie karty
   params: { cardName: string, targetList: string }

── GMAIL — WYSYŁANIE ──
3. gmail_send — wysłanie emaila
   params: { to: string, subject: string, body: string, cc?: string, htmlBody?: string }
4. gmail_draft — utworzenie draftu emaila
   params: { to: string, subject: string, body: string, cc?: string, htmlBody?: string }
5. gmail_reply — odpowiedź na email (wymaga messageId z gmail_list lub gmail_read)
   params: { messageId: string, body: string, replyAll?: boolean }
6. gmail_forward — prześlij email dalej
   params: { messageId: string, to: string, comment?: string }

── GMAIL — ODCZYT ──
7. gmail_list — lista emaili (inbox, nieprzeczytane, wysłane, itp.)
   params: { query?: string, maxResults?: number (domyślnie 10), label?: string (INBOX|SENT|DRAFT|STARRED|SPAM|TRASH|UNREAD), pageToken?: string }
   Zwraca: { emails: [{id, from, to, subject, date, snippet, isUnread, isStarred, hasAttachments}], total, nextPageToken }
8. gmail_read — przeczytaj pełną treść emaila
   params: { messageId: string, markAsRead?: boolean (domyślnie true) }
   Zwraca: pełny email z body, attachments, headers
9. gmail_search — wyszukaj emaile (Gmail search syntax: "from:jan subject:raport after:2025/01/01 has:attachment")
   params: { query: string, maxResults?: number }
10. gmail_thread — pobierz cały wątek emailowy
    params: { threadId: string, maxResults?: number }

── GMAIL — ORGANIZACJA ──
11. gmail_trash — przenieś email do kosza
    params: { messageId: string }
12. gmail_untrash — przywróć email z kosza
    params: { messageId: string }
13. gmail_mark_read — oznacz jako przeczytany/nieprzeczytany
    params: { messageId: string, read?: boolean (domyślnie true) }
14. gmail_star — oznacz/odznacz gwiazdkę
    params: { messageId: string, starred?: boolean (domyślnie true) }
15. gmail_labels — pobierz listę etykiet Gmail
    params: {} (brak)
16. gmail_modify_labels — dodaj/usuń etykiety z emaila
    params: { messageId: string, addLabels?: string[], removeLabels?: string[] }
17. gmail_batch_modify — zbiorcza operacja na wielu emailach
    params: { messageIds: string[], addLabels?: string[], removeLabels?: string[] }
18. gmail_profile — informacje o koncie Gmail
    params: {} (brak)

── KALENDARZ ──
19. calendar_create — utworzenie wydarzenia w kalendarzu
    params: { title: string, date: string (ISO), duration?: number (minuty), description?: string }
20. calendar_list — lista nadchodzących wydarzeń
    params: { days?: number }

── NOTATKI ──
21. reminder — ustawienie przypomnienia
    params: { text: string, date: string (ISO) }
22. note — zapisanie notatki
    params: { text: string, tags?: string[] }

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
