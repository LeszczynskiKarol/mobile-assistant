import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  getConversation,
  ConversationDetail,
  ConversationMessage,
} from "../services/api";

export default function ConversationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filteredMessages, setFilteredMessages] = useState<
    ConversationMessage[] | null
  >(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getConversation(id)
      .then(setConv)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Szukanie w konwersacji — debounced
  useEffect(() => {
    if (!id) return;
    if (search.trim().length < 2) {
      setFilteredMessages(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await getConversation(id, search.trim());
        setFilteredMessages(data.messages);
      } catch {
        setFilteredMessages(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, id]);

  const messagesToShow = filteredMessages ?? conv?.messages ?? [];

  const continueConversation = () => {
    router.push({ pathname: "/", params: { conversationId: id } });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#3b82f6" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (!conv) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.emptyText}>Nie znaleziono konwersacji</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Wstecz</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {conv.topic}
        </Text>
        <Pressable onPress={continueConversation} style={styles.continueBtn}>
          <Text style={styles.continueText}>▶</Text>
        </Pressable>
      </View>

      {/* Stats */}
      <View style={styles.statsBar}>
        <Text style={styles.stat}>
          {conv.stats.messageCount} wiad.
        </Text>
        <Text style={styles.stat}>
          {conv.stats.totalTokens.toLocaleString()} tok
        </Text>
        <Text style={styles.stat}>
          ${conv.stats.totalCostUsd.toFixed(4)}
        </Text>
        <Text style={styles.stat}>
          {new Date(conv.createdAt).toLocaleDateString("pl-PL")}
        </Text>
      </View>

      {/* Search within conversation */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Szukaj w tej konwersacji..."
          placeholderTextColor="#475569"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} style={styles.clearSearch}>
            <Text style={styles.clearSearchText}>✕</Text>
          </Pressable>
        )}
      </View>

      {filteredMessages !== null && (
        <View style={styles.filterInfo}>
          <Text style={styles.filterText}>
            Znaleziono {filteredMessages.length} wiadomości
          </Text>
        </View>
      )}

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
      >
        {messagesToShow.map((msg) => (
          <MessageBubble key={msg.id} message={msg} highlight={search.trim()} />
        ))}
        {messagesToShow.length === 0 && (
          <Text style={styles.emptyText}>Brak wyników</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Message bubble z opcjonalnym podświetleniem i statystykami ──

function MessageBubble({
  message,
  highlight,
}: {
  message: ConversationMessage;
  highlight: string;
}) {
  const isUser = message.role === "user";
  const [showStats, setShowStats] = useState(false);

  return (
    <Pressable
      style={[
        styles.bubble,
        isUser ? styles.bubbleUser : styles.bubbleAssistant,
      ]}
      onPress={() => !isUser && setShowStats(!showStats)}
    >
      <Text style={styles.bubbleRole}>{isUser ? "🗣️ Ty" : "🤖 Asystent"}</Text>
      <Text style={styles.bubbleText}>
        {highlight ? highlightText(message.content, highlight) : message.content}
      </Text>

      {/* Statystyki per-wiadomość (tylko assistant, tap to toggle) */}
      {!isUser && showStats && (
        <View style={styles.msgStats}>
          {message.inputTokens != null && (
            <Text style={styles.msgStatText}>
              In: {message.inputTokens} | Out: {message.outputTokens} | Σ:{" "}
              {message.totalTokens}
            </Text>
          )}
          {message.costUsd != null && (
            <Text style={styles.msgStatText}>
              ${message.costUsd.toFixed(5)} | {message.latencyMs}ms |{" "}
              {message.model}
            </Text>
          )}
          {message.thinking && (
            <Text style={styles.msgThinking}>💭 {message.thinking}</Text>
          )}
          {message.actions && Array.isArray(message.actions) && (
            <Text style={styles.msgStatText}>
              Akcje: {(message.actions as any[]).map((a: any) => a.action).join(", ")}
            </Text>
          )}
        </View>
      )}

      <Text style={styles.bubbleTime}>
        {new Date(message.createdAt).toLocaleTimeString("pl-PL", {
          hour: "2-digit",
          minute: "2-digit",
        })}
        {!isUser && message.costUsd != null && ` · $${message.costUsd.toFixed(5)}`}
      </Text>
    </Pressable>
  );
}

function highlightText(text: string, term: string): string {
  // W React Native nie ma łatwego HTML highlight — zwracamy tekst z markerami
  // Na produkcji można użyć Text z zagnieżdżonymi <Text style=bold>
  return text;
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  backBtn: { paddingVertical: 4, paddingRight: 8 },
  backText: { color: "#3b82f6", fontSize: 15, fontWeight: "600" },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: "#f1f5f9",
    marginHorizontal: 8,
  },
  continueBtn: {
    backgroundColor: "#1e40af",
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  continueText: { color: "#fff", fontSize: 14 },
  statsBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  stat: { color: "#64748b", fontSize: 11 },
  searchRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    backgroundColor: "#1e293b",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: "#f1f5f9",
    fontSize: 13,
  },
  clearSearch: { marginLeft: 8, padding: 6 },
  clearSearchText: { color: "#94a3b8", fontSize: 14 },
  filterInfo: { paddingHorizontal: 16, paddingBottom: 4 },
  filterText: { color: "#f59e0b", fontSize: 12 },
  messages: { flex: 1 },
  messagesContent: { padding: 16, paddingBottom: 40 },
  bubble: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    maxWidth: "90%",
  },
  bubbleUser: {
    backgroundColor: "#1e3a5f",
    alignSelf: "flex-end",
  },
  bubbleAssistant: {
    backgroundColor: "#1e293b",
    alignSelf: "flex-start",
  },
  bubbleRole: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "600",
    marginBottom: 4,
  },
  bubbleText: {
    color: "#e2e8f0",
    fontSize: 15,
    lineHeight: 22,
  },
  bubbleTime: {
    color: "#475569",
    fontSize: 10,
    marginTop: 6,
    textAlign: "right",
  },
  msgStats: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  msgStatText: { color: "#64748b", fontSize: 11, marginBottom: 2 },
  msgThinking: { color: "#f59e0b", fontSize: 11, fontStyle: "italic", marginTop: 2 },
  emptyText: {
    color: "#64748b",
    fontSize: 15,
    textAlign: "center",
    marginTop: 40,
  },
});
