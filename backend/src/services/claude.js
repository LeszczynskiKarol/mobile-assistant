import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // uses ANTHROPIC_API_KEY from env

// System prompt — definiuje dostępne akcje jako tekst, nie jako tool_use schema
// To jest DUŻO tańsze niż tool_use bo nie dodaje ~1000 tokenów definicji tools
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
 * Interpretuje tekst z voice i zwraca structured JSON z akcjami
 */
export async function interpretIntent(text, opts = {}) {
  const { context, history } = opts;

  const now = new Date().toLocaleString("pl-PL", {
    timeZone: "Europe/Warsaw",
    dateStyle: "full",
    timeStyle: "short",
  });

  const systemPrompt = SYSTEM_PROMPT.replace("{{CURRENT_TIME}}", now);

  // Buduj messages — opcjonalnie z historią konwersacji
  const messages = [];

  if (history?.length) {
    for (const msg of history.slice(-10)) {
      // max 10 ostatnich wiadomości
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  let userContent = text;
  if (context) {
    userContent += `\n\n[Kontekst: ${JSON.stringify(context)}]`;
  }
  messages.push({ role: "user", content: userContent });

  const response = await client.messages.create({
    model: "claude-haiku-4-5", // sonnet = tani i szybki, wystarczy do intent detection
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const raw = response.content[0]?.text || "";

  try {
    // Parsuj JSON — Claude powinien zwracać czysty JSON
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
    };
  } catch (parseErr) {
    // Fallback — Claude zwrócił tekst zamiast JSON
    return {
      response: raw.slice(0, 500),
      actions: [],
      thinking: "Parse error — Claude nie zwrócił JSON",
      needsInput: false,
    };
  }
}
