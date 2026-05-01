import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  getConversations,
  globalSearch,
  getStats,
  deleteConversation,
  updateConversationTopic,
  ConversationSummary,
  GlobalStats,
  SearchResult,
} from "../services/api";

export default function ConversationsScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTopic, setEditTopic] = useState("");

  const fetchData = useCallback(async (p = 1) => {
    try {
      const [convData, statsData] = await Promise.all([
        getConversations(p, 20),
        getStats(),
      ]);
      if (p === 1) {
        setConversations(convData.conversations);
      } else {
        setConversations((prev) => [...prev, ...convData.conversations]);
      }
      setTotalPages(convData.pagination.totalPages);
      setStats(statsData);
    } catch (err: any) {
      Alert.alert("Błąd", err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    setPage(1);
    fetchData(1);
  };

  const loadMore = () => {
    if (page < totalPages) {
      const next = page + 1;
      setPage(next);
      fetchData(next);
    }
  };

  // ── Wyszukiwanie globalne ───────────────────────────────────

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await globalSearch(searchQuery.trim());
        setSearchResults(results);
      } catch {
        setSearchResults(null);
      }
      setIsSearching(false);
    }, 400); // debounce 400ms

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── Edycja tematu ───────────────────────────────────────────

  const startEdit = (conv: ConversationSummary) => {
    setEditingId(conv.id);
    setEditTopic(conv.topic);
  };

  const saveEdit = async () => {
    if (!editingId || !editTopic.trim()) return;
    try {
      await updateConversationTopic(editingId, editTopic.trim());
      setConversations((prev) =>
        prev.map((c) =>
          c.id === editingId ? { ...c, topic: editTopic.trim() } : c,
        ),
      );
    } catch {
      Alert.alert("Błąd", "Nie udało się zapisać tematu");
    }
    setEditingId(null);
  };

  // ── Usuwanie ────────────────────────────────────────────────

  const confirmDelete = (id: string) => {
    Alert.alert("Usuń konwersację", "Na pewno?", [
      { text: "Anuluj", style: "cancel" },
      {
        text: "Usuń",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteConversation(id);
            setConversations((prev) => prev.filter((c) => c.id !== id));
          } catch {
            Alert.alert("Błąd", "Nie udało się usunąć");
          }
        },
      },
    ]);
  };

  // ── Nawigacja ───────────────────────────────────────────────

  const openConversation = (id: string) => {
    router.push({ pathname: "/conversation/[id]", params: { id } });
  };

  const goToVoice = (conversationId?: string) => {
    if (conversationId) {
      router.push({
        pathname: "/",
        params: { conversationId },
      });
    } else {
      router.push("/");
    }
  };

  // ── Render ──────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#3b82f6" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => goToVoice()} style={styles.backBtn}>
          <Text style={styles.backText}>← Nowa</Text>
        </Pressable>
        <Text style={styles.title}>Historia</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Stats bar */}
      {stats && (
        <View style={styles.statsBar}>
          <Stat label="Konwersacje" value={stats.totalConversations} />
          <Stat label="Wiadomości" value={stats.totalMessages} />
          <Stat label="Tokeny" value={formatTokens(stats.tokens.total)} />
          <Stat label="Koszt" value={`$${stats.totalCostUsd.toFixed(3)}`} />
        </View>
      )}

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Szukaj we wszystkich konwersacjach..."
          placeholderTextColor="#475569"
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <Pressable
            onPress={() => setSearchQuery("")}
            style={styles.clearSearch}
          >
            <Text style={styles.clearSearchText}>✕</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3b82f6"
          />
        }
      >
        {/* Wyniki wyszukiwania */}
        {isSearching && (
          <ActivityIndicator
            size="small"
            color="#3b82f6"
            style={{ marginVertical: 20 }}
          />
        )}

        {searchResults && !isSearching && (
          <>
            {searchResults.conversationResults.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Konwersacje ({searchResults.conversationResults.length})
                </Text>
                {searchResults.conversationResults.map((c) => (
                  <Pressable
                    key={c.id}
                    style={styles.searchItem}
                    onPress={() => openConversation(c.id)}
                  >
                    <Text style={styles.searchTopic}>{c.topic}</Text>
                    <Text style={styles.searchMeta}>
                      {c.messageCount} wiad.
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Wiadomości ({searchResults.messageResults.pagination.total})
              </Text>
              {searchResults.messageResults.messages.map((m) => (
                <Pressable
                  key={m.id}
                  style={styles.searchItem}
                  onPress={() => openConversation(m.conversationId)}
                >
                  <Text style={styles.searchConvTopic}>
                    {m.conversationTopic}
                  </Text>
                  <Text style={styles.searchContext} numberOfLines={3}>
                    {m.role === "user" ? "🗣️ " : "🤖 "}
                    {m.matchContext}
                  </Text>
                </Pressable>
              ))}
              {searchResults.messageResults.messages.length === 0 && (
                <Text style={styles.emptyText}>Brak wyników</Text>
              )}
            </View>
          </>
        )}

        {/* Lista konwersacji (gdy nie szukamy) */}
        {!searchResults &&
          conversations.map((conv) => (
            <Pressable
              key={conv.id}
              style={styles.convItem}
              onPress={() => openConversation(conv.id)}
              onLongPress={() => confirmDelete(conv.id)}
            >
              {editingId === conv.id ? (
                <View style={styles.editRow}>
                  <TextInput
                    style={styles.editInput}
                    value={editTopic}
                    onChangeText={setEditTopic}
                    onSubmitEditing={saveEdit}
                    onBlur={saveEdit}
                    autoFocus
                  />
                </View>
              ) : (
                <>
                  <View style={styles.convHeader}>
                    <Text style={styles.convTopic} numberOfLines={1}>
                      {conv.topic}
                    </Text>
                    <Pressable onPress={() => startEdit(conv)}>
                      <Text style={styles.editBtn}>✏️</Text>
                    </Pressable>
                  </View>
                  {conv.lastMessage && (
                    <Text style={styles.convPreview} numberOfLines={2}>
                      {conv.lastMessage.role === "user" ? "🗣️ " : "🤖 "}
                      {conv.lastMessage.content}
                    </Text>
                  )}
                  <View style={styles.convMeta}>
                    <Text style={styles.convMetaText}>
                      {conv.messageCount} wiad.
                    </Text>
                    <Text style={styles.convMetaText}>
                      {(
                        conv.totalInputTokens + conv.totalOutputTokens
                      ).toLocaleString()}{" "}
                      tok
                    </Text>
                    <Text style={styles.convMetaText}>
                      ${conv.totalCostUsd.toFixed(4)}
                    </Text>
                    <Text style={styles.convMetaText}>
                      {formatDate(conv.updatedAt)}
                    </Text>
                  </View>
                </>
              )}

              {/* Przycisk kontynuacji */}
              <Pressable
                style={styles.continueBtn}
                onPress={() => goToVoice(conv.id)}
              >
                <Text style={styles.continueBtnText}>Kontynuuj ▶</Text>
              </Pressable>
            </Pressable>
          ))}

        {!searchResults && conversations.length === 0 && (
          <Text style={styles.emptyText}>
            Brak konwersacji. Zacznij nową rozmowę!
          </Text>
        )}

        {!searchResults && page < totalPages && (
          <Pressable style={styles.loadMoreBtn} onPress={loadMore}>
            <Text style={styles.loadMoreText}>Załaduj więcej</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Helpers ───────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86_400_000) {
    return d.toLocaleTimeString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (diff < 7 * 86_400_000) {
    return d.toLocaleDateString("pl-PL", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  backBtn: { paddingVertical: 4, paddingRight: 8 },
  backText: { color: "#3b82f6", fontSize: 15, fontWeight: "600" },
  title: { fontSize: 18, fontWeight: "700", color: "#f1f5f9" },
  statsBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  statItem: { alignItems: "center" },
  statValue: { color: "#f1f5f9", fontSize: 16, fontWeight: "700" },
  statLabel: { color: "#64748b", fontSize: 10, marginTop: 2 },
  searchRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    backgroundColor: "#1e293b",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: "#f1f5f9",
    fontSize: 14,
  },
  clearSearch: {
    marginLeft: 8,
    padding: 8,
  },
  clearSearchText: { color: "#94a3b8", fontSize: 16 },
  list: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 20 },
  sectionTitle: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  searchItem: {
    backgroundColor: "#1e293b",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  searchTopic: { color: "#f1f5f9", fontSize: 15, fontWeight: "600" },
  searchMeta: { color: "#64748b", fontSize: 12, marginTop: 4 },
  searchConvTopic: {
    color: "#3b82f6",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  searchContext: { color: "#cbd5e1", fontSize: 13, lineHeight: 20 },
  convItem: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  convHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  convTopic: {
    color: "#f1f5f9",
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    marginRight: 8,
  },
  editBtn: { fontSize: 14, padding: 4 },
  editRow: { marginBottom: 8 },
  editInput: {
    backgroundColor: "#0f172a",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#f1f5f9",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#3b82f6",
  },
  convPreview: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  convMeta: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  convMetaText: { color: "#475569", fontSize: 11 },
  continueBtn: {
    marginTop: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#334155",
    alignItems: "center",
  },
  continueBtnText: { color: "#3b82f6", fontSize: 13, fontWeight: "600" },
  emptyText: {
    color: "#64748b",
    fontSize: 15,
    textAlign: "center",
    marginTop: 40,
  },
  loadMoreBtn: {
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#1e293b",
    borderRadius: 10,
    marginTop: 8,
  },
  loadMoreText: { color: "#3b82f6", fontSize: 14, fontWeight: "600" },
});
