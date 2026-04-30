const API_URL = __DEV__ ? "https://voice.torweb.pl" : "https://voice.torweb.pl";
const VOICE_TOKEN =
  "f7c26267a418c3ddeaafbdcbf3e883e958b68f7df586e8b58492a6869b9e36dd";

const headers = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${VOICE_TOKEN}`,
});

// ── Types ──

export type ModelId = "claude-haiku-4-5" | "claude-sonnet-4-6";

export interface VoiceAction {
  action: string;
  params: Record<string, any>;
  status?: "success" | "error";
  result?: any;
  error?: string;
}

export interface VoiceStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  model: string;
  latencyMs: number;
}

export interface Source {
  index: number;
  title: string;
  url: string;
}

export interface VoiceResponse {
  response: string;
  actions: VoiceAction[];
  thinking?: string;
  needsInput?: boolean;
  conversationId: string;
  messageId: string;
  isNewConversation: boolean;
  stats: VoiceStats;
  sources: Source[];
  researchStatus: string[];
  didResearch: boolean;
  error?: string;
}

export interface StreamEvent {
  type: "status" | "result";
  message?: string; // for status
  response?: string; // for result
  [key: string]: any; // rest of VoiceResponse fields
}

export interface ConversationSummary {
  id: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  lastMessage: { content: string; role: string; createdAt: string } | null;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  model?: string;
  latencyMs?: number;
  actions?: any;
  thinking?: string;
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  stats: {
    messageCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
  };
  messages: ConversationMessage[];
}

export interface SearchResult {
  query: string;
  messageResults: {
    messages: {
      id: string;
      role: string;
      content: string;
      createdAt: string;
      conversationId: string;
      conversationTopic: string;
      matchContext: string;
    }[];
    pagination: { total: number };
  };
  conversationResults: {
    id: string;
    topic: string;
    messageCount: number;
    updatedAt: string;
  }[];
}

export interface GlobalStats {
  totalConversations: number;
  totalMessages: number;
  todayMessages: number;
  tokens: { totalInput: number; totalOutput: number; total: number };
  totalCostUsd: number;
  totalCostPln: string;
}

// ── Voice command (non-streaming, for normal requests) ──

export async function sendVoiceCommand(
  text: string,
  conversationId?: string,
  model: ModelId = "claude-haiku-4-5",
): Promise<VoiceResponse> {
  const res = await fetch(`${API_URL}/api/voice`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ text, conversationId, model, stream: false }),
  });
  if (!res.ok)
    throw new Error(`Server error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Voice command (streaming, for research) ──

export function sendVoiceStreaming(
  text: string,
  conversationId: string | undefined,
  model: ModelId,
  onStatus: (msg: string) => void,
): Promise<VoiceResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/voice`);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", `Bearer ${VOICE_TOKEN}`);

    let lastIndex = 0;

    xhr.onprogress = () => {
      const newChunk = xhr.responseText.substring(lastIndex);
      lastIndex = xhr.responseText.length;

      const lines = newChunk.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "status" && event.message) {
            onStatus(event.message);
          }
        } catch {}
      }
    };

    xhr.onload = () => {
      const lines = xhr.responseText.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === "result") {
            resolve(event as unknown as VoiceResponse);
            return;
          }
        } catch {}
      }
      reject(new Error("No result in stream"));
    };

    xhr.onerror = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Timeout"));
    xhr.timeout = 120000;

    xhr.send(JSON.stringify({ text, conversationId, model, stream: true }));
  });
}

// ── Other endpoints (unchanged) ──

export async function getConversations(page = 1, limit = 20, search?: string) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (search) params.set("search", search);
  const res = await fetch(`${API_URL}/api/conversations?${params}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json() as Promise<{
    conversations: ConversationSummary[];
    pagination: any;
  }>;
}

export async function getConversation(
  id: string,
  search?: string,
): Promise<ConversationDetail> {
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await fetch(`${API_URL}/api/conversations/${id}${q}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}

export async function updateConversationTopic(id: string, topic: string) {
  await fetch(`${API_URL}/api/conversations/${id}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ topic }),
  });
}

export async function deleteConversation(id: string) {
  await fetch(`${API_URL}/api/conversations/${id}`, {
    method: "DELETE",
    headers: headers(),
  });
}

export async function globalSearch(q: string): Promise<SearchResult> {
  const res = await fetch(
    `${API_URL}/api/search?q=${encodeURIComponent(q)}&limit=20`,
    { headers: headers() },
  );
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}

export async function getStats(): Promise<GlobalStats> {
  const res = await fetch(`${API_URL}/api/stats`, { headers: headers() });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}
