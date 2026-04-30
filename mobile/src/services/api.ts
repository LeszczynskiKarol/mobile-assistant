// Zmień na adres Twojego serwera
const API_URL = __DEV__
  ? 'http://192.168.1.100:3001'   // lokalne IP dev maszyny, port copywriting24
  : 'https://copywriting24.pl';   // produkcja — ten sam serwer

// ⚠️ Wklej tutaj swój VOICE_API_TOKEN (ten sam co w .env backendu)
const VOICE_TOKEN = 'ZMIEN_NA_SWOJ_TOKEN';

export interface VoiceAction {
  action: string;
  params: Record<string, any>;
  status?: 'success' | 'error';
  result?: any;
  error?: string;
}

export interface VoiceResponse {
  response: string;
  actions: VoiceAction[];
  thinking?: string;
  needsInput?: boolean;
  error?: string;
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Wyślij tekst do backendu i odbierz odpowiedź z akcjami
 */
export async function sendVoiceCommand(
  text: string,
  history: HistoryMessage[] = []
): Promise<VoiceResponse> {
  const res = await fetch(`${API_URL}/api/voice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${VOICE_TOKEN}`,
    },
    body: JSON.stringify({ text, history })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Server error ${res.status}: ${errText}`);
  }

  return res.json();
}

/**
 * Sprawdź dostępne akcje (do debugowania)
 */
export async function getAvailableActions() {
  const res = await fetch(`${API_URL}/api/voice/actions`, {
    headers: { 'Authorization': `Bearer ${VOICE_TOKEN}` },
  });
  return res.json();
}
