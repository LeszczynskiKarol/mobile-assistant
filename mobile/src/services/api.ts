const API_URL = __DEV__ ? "https://voice.torweb.pl" : "https://voice.torweb.pl";
const VOICE_TOKEN = "f7c26267a418c3ddeaafbdcbf3e883e958b68f7df586e8b58492a6869b9e36dd";

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

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
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

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ── Endpoints ──

export async function sendVoiceCommand(
  text: string,
  conversationId?: string,
  model: ModelId = "claude-haiku-4-5",
): Promise<VoiceResponse> {
  const res = await fetch(`${API_URL}/api/voice`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ text, conversationId, model }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getConversations(
  page = 1,
  limit = 20,
  search?: string,
): Promise<{ conversations: ConversationSummary[]; pagination: Pagination }> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set("search", search);
  const res = await fetch(`${API_URL}/api/conversations?${params}`, { headers: headers() });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}

export async function getConversation(id: string, search?: string): Promise<ConversationDetail> {
  const q = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await fetch(`${API_URL}/api/conversations/${id}${q}`, { headers: headers() });
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
  await fetch(`${API_URL}/api/conversations/${id}`, { method: "DELETE", headers: headers() });
}

export async function globalSearch(q: string): Promise<SearchResult> {
  const res = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(q)}&limit=20`, { headers: headers() });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}

export async function getStats(): Promise<GlobalStats> {
  const res = await fetch(`${API_URL}/api/stats`, { headers: headers() });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json();
}
