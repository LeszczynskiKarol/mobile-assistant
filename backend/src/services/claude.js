import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // uses ANTHROPIC_API_KEY from env

// Cennik Claude Haiku 4.5 (USD per 1M tokens)
const PRICING = {
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
};

function calculateCost(model, inputTokens, outputTokens) {
  const prices = PRICING[model] || PRICING["claude-haiku-4-5"];
  return (
    (inputTokens / 1_000_000) * prices.input +
    (outputTokens / 1_000_000) * prices.output
  );
}

const SYSTEM_PROMPT = `Jesteś głosowym asystentem Karola. Interpretujesz polecenia głosowe i zwracasz JSON z akcjami do wykonania.

DOSTĘPNE AKCJE:
1. trello_create_card — tworzenie karty w Trello
   params: { title: string, description?: string, listId?: string, labels?: string[] }

2. trello_move_card — przeniesienie karty
   params: { cardName: string, targetList: string }

3. gmail_send — wysłanie emaila
   params: { to: string, subject: string, body: string }

4. gmail_draft — utworzenie draftu emaila
   params: { to: string, subject: string, body: string }

5. calendar_create — utworzenie wydarzenia w kalendarzu
   params: { title: string, date: string (ISO), duration?: number (minuty), description?: string }

6. calendar_list — lista nadchodzących wydarzeń
   params: { days?: number }

7. reminder — ustawienie przypomnienia
   params: { text: string, date: string (ISO) }

8. note — zapisanie notatki
   params: { text: string, tags?: string[] }

9. web_search — wyszukanie informacji w internecie
   params: { query: string }

ZASADY:
- Odpowiadaj ZAWSZE po polsku
- Zwracaj TYLKO valid JSON, bez markdown, bez backticks
- Jeśli polecenie wymaga wielu akcji, zwróć tablicę actions
- Jeśli polecenie to pytanie lub rozmowa, zwróć pustą tablicę actions
- Pole "response" to tekst który zostanie odczytany na głos — pisz naturalnie, krótko
- Pole "thinking" to krótkie wyjaśnienie co zrozumiałeś (do debugowania)
- Jeśli brakuje informacji do wykonania akcji, zapytaj w "response" i ustaw "needsInput": true
- Daty relatywne (jutro, za godzinę, w piątek) rozwiązuj względem TERAZ

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

/**
 * Interpretuje tekst z voice i zwraca structured JSON z akcjami + statystyki tokenów
 */
export async function interpretIntent(text, opts = {}) {
  const { context, history } = opts;
  const startTime = Date.now();

  const now = new Date().toLocaleString("pl-PL", {
    timeZone: "Europe/Warsaw",
    dateStyle: "full",
    timeStyle: "short",
  });

  const systemPrompt = SYSTEM_PROMPT.replace("{{CURRENT_TIME}}", now);

  // Buduj messages — opcjonalnie z historią konwersacji
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

  const model = "claude-haiku-4-5";

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const latencyMs = Date.now() - startTime;
  const raw = response.content[0]?.text || "";
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  const costUsd = calculateCost(model, inputTokens, outputTokens);

  // Statystyki wspólne dla obu ścieżek
  const stats = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd,
    model,
    latencyMs,
  };

  try {
    const cleaned = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    return {
      response: parsed.response || "Nie zrozumiałem polecenia.",
      actions: parsed.actions || [],
      thinking: parsed.thinking || "",
      needsInput: parsed.needsInput || false,
      ...stats,
    };
  } catch (parseErr) {
    return {
      response: raw.slice(0, 500),
      actions: [],
      thinking: "Parse error — Claude nie zwrócił JSON",
      needsInput: false,
      ...stats,
    };
  }
}

/**
 * Generuje krótki temat konwersacji na podstawie pierwszego promptu.
 * Zwraca string 3-6 słów po polsku.
 */
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
