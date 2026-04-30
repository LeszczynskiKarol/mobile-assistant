import { useRef, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  SafeAreaView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  useVoiceAssistant,
  VoiceState,
  LogEntry,
} from "../hooks/useVoiceAssistant";
import { getConversation, Source, ModelId } from "../services/api";

const STATE_CONFIG: Record<VoiceState, { label: string; color: string }> = {
  idle: { label: "🎤", color: "#1e293b" },
  listening: { label: "🔴", color: "#dc2626" },
  processing: { label: "⏳", color: "#f59e0b" },
  researching: { label: "🔍", color: "#8b5cf6" },
  speaking: { label: "🔊", color: "#2563eb" },
};

const MODELS: { id: ModelId; label: string; short: string }[] = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5 — szybki", short: "H" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 — smart", short: "S" },
];

// ── Source Bibliography ───────────────────────────────────────

function SourceBibliography({ sources }: { sources: Source[] }) {
  if (!sources?.length) return null;
  return (
    <View style={styles.sourcesContainer}>
      <Text style={styles.sourcesTitle}>📚 Źródła</Text>
      {sources.map((s) => (
        <Pressable
          key={s.index}
          style={styles.sourceItem}
          onPress={() => Linking.openURL(s.url)}
        >
          <Text style={styles.sourceIndex}>[{s.index}]</Text>
          <View style={styles.sourceText}>
            <Text style={styles.sourceTitle} numberOfLines={1}>
              {s.title}
            </Text>
            <Text style={styles.sourceUrl} numberOfLines={1}>
              {s.url}
            </Text>
          </View>
          <Text style={styles.sourceArrow}>↗</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── Research Status Log ───────────────────────────────────────

function ResearchLog({ text }: { text: string }) {
  const lines = text.split("\n").filter(Boolean);
  return (
    <View style={styles.researchLog}>
      <Text style={styles.researchLogTitle}>🔍 Proces wyszukiwania:</Text>
      {lines.map((line, i) => (
        <Text key={i} style={styles.researchLogLine}>
          {line}
        </Text>
      ))}
    </View>
  );
}

// ── Response with interactive footnotes ───────────────────────

function ResponseText({
  text,
  sources,
  onSourcePress,
}: {
  text: string;
  sources?: Source[];
  onSourcePress?: (source: Source) => void;
}) {
  if (!sources?.length) {
    return <Text style={styles.logText}>{text}</Text>;
  }

  // Parse [1], [2], [3] etc. into tappable elements
  const parts: {
    type: "text" | "footnote";
    content: string;
    index?: number;
  }[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: "text", content: text.slice(lastIdx, match.index) });
    }
    parts.push({
      type: "footnote",
      content: match[0],
      index: parseInt(match[1]),
    });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push({ type: "text", content: text.slice(lastIdx) });
  }

  return (
    <Text style={styles.logText}>
      {parts.map((p, i) => {
        if (p.type === "footnote") {
          const source = sources.find((s) => s.index === p.index);
          return (
            <Text
              key={i}
              style={styles.footnote}
              onPress={() =>
                source &&
                (onSourcePress
                  ? onSourcePress(source)
                  : Linking.openURL(source.url))
              }
            >
              {p.content}
            </Text>
          );
        }
        return <Text key={i}>{p.content}</Text>;
      })}
    </Text>
  );
}

// ── Log Item ──────────────────────────────────────────────────

function LogItem({ entry }: { entry: LogEntry }) {
  const [showStats, setShowStats] = useState(false);
  const [expandedSource, setExpandedSource] = useState<Source | null>(null);

  const colors: Record<string, string> = {
    user: "#60a5fa",
    assistant: "#f1f5f9",
    action: "#4ade80",
    error: "#f87171",
    "research-status": "#a78bfa",
  };

  if (entry.type === "research-status") {
    return <ResearchLog text={entry.text} />;
  }

  if (entry.type === "action" || entry.type === "error") {
    return (
      <View style={[styles.logItem, { borderLeftColor: colors[entry.type] }]}>
        <Text
          style={[
            styles.logText,
            {
              fontSize: 12,
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
            },
          ]}
        >
          {entry.text}
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.logItem, { borderLeftColor: colors[entry.type] }]}
      onPress={() => entry.stats && setShowStats(!showStats)}
    >
      <Text style={styles.logRole}>
        {entry.type === "user" ? "🗣️ Ty" : "🤖 Asystent"}
        {entry.didResearch && " 🔍"}
      </Text>

      <ResponseText
        text={entry.text}
        sources={entry.sources}
        onSourcePress={(s) =>
          setExpandedSource(expandedSource?.index === s.index ? null : s)
        }
      />

      {/* Expanded source tooltip */}
      {expandedSource && (
        <Pressable
          style={styles.sourceTooltip}
          onPress={() => Linking.openURL(expandedSource.url)}
        >
          <Text style={styles.sourceTooltipTitle}>
            [{expandedSource.index}] {expandedSource.title}
          </Text>
          <Text style={styles.sourceTooltipUrl}>{expandedSource.url} ↗</Text>
        </Pressable>
      )}

      {/* Sources bibliography */}
      {entry.sources && entry.sources.length > 0 && (
        <SourceBibliography sources={entry.sources} />
      )}

      {/* Stats */}
      {showStats && entry.stats && (
        <View style={styles.statsDetail}>
          <Text style={styles.statsDetailText}>
            {entry.stats.inputTokens} in + {entry.stats.outputTokens} out ={" "}
            {entry.stats.totalTokens} tok
          </Text>
          <Text style={styles.statsDetailText}>
            ${entry.stats.costUsd.toFixed(5)} · {entry.stats.latencyMs}ms ·{" "}
            {entry.stats.model}
          </Text>
        </View>
      )}

      <Text style={styles.logTime}>
        {entry.timestamp.toLocaleTimeString("pl-PL", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
        {entry.stats && ` · $${entry.stats.costUsd.toFixed(5)}`}
      </Text>
    </Pressable>
  );
}

// ── Model Picker ──────────────────────────────────────────────

function ModelPicker({
  model,
  onChange,
}: {
  model: ModelId;
  onChange: (m: ModelId) => void;
}) {
  return (
    <View style={styles.modelPicker}>
      {MODELS.map((m) => (
        <Pressable
          key={m.id}
          style={[styles.modelBtn, model === m.id && styles.modelBtnActive]}
          onPress={() => onChange(m.id)}
        >
          <Text
            style={[
              styles.modelBtnText,
              model === m.id && styles.modelBtnTextActive,
            ]}
          >
            {m.short}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main Screen
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function VoiceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const {
    state,
    transcript,
    log,
    conversationId,
    model,
    liveStatus, // ← DODAJ liveStatus
    setModel,
    toggle,
    newConversation,
    loadConversation,
    processText,
    voiceAvailable,
  } = useVoiceAssistant();
  const scrollRef = useRef<ScrollView>(null);
  const config = STATE_CONFIG[state];
  const [textInput, setTextInput] = useState("");

  useEffect(() => {
    if (params.conversationId) {
      getConversation(params.conversationId).then((data) => {
        loadConversation(
          data.id,
          data.messages.map((m) => ({
            role: m.role,
            content: m.content,
            stats:
              m.inputTokens != null
                ? {
                    inputTokens: m.inputTokens!,
                    outputTokens: m.outputTokens!,
                    totalTokens: m.totalTokens!,
                    costUsd: m.costUsd!,
                    model: m.model!,
                    latencyMs: m.latencyMs!,
                  }
                : undefined,
          })),
        );
      });
    }
  }, [params.conversationId]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [log.length]);

  const handleSendText = async () => {
    const text = textInput.trim();
    if (!text || state === "processing" || state === "researching") return;
    setTextInput("");
    await processText(text);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Smart Omni</Text>
        <View style={styles.headerRight}>
          <ModelPicker model={model} onChange={setModel} />
          {conversationId && (
            <Pressable onPress={newConversation} style={styles.newBtn}>
              <Text style={styles.newBtnText}>+</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => router.push("/conversations")}
            style={styles.historyBtn}
          >
            <Text style={styles.historyBtnText}>📋</Text>
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.logContainer}
          contentContainerStyle={styles.logContent}
        >
          {log.length === 0 && (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🎤</Text>
              <Text style={styles.emptyTitle}>Smart Omni</Text>
              <Text style={styles.emptyText}>
                Asystent AI z automatycznym researchem online.
                {"\n"}Kliknij mikrofon lub wpisz komendę.
              </Text>
              <View style={styles.examplesGrid}>
                {[
                  "Utwórz kartę w Trello",
                  "Jakie są najnowsze modele Claude?",
                  "Porównaj React vs Vue w 2026",
                  "Co mam w kalendarzu?",
                ].map((ex) => (
                  <Pressable
                    key={ex}
                    style={styles.exampleChip}
                    onPress={() => {
                      setTextInput(ex);
                    }}
                  >
                    <Text style={styles.exampleText}>„{ex}"</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          {log.map((entry) => (
            <LogItem key={entry.id} entry={entry} />
          ))}

          {/* Research spinner */}
          {(state === "processing" || state === "researching") && (
            <View style={styles.liveStatusBox}>
              <View style={styles.spinnerRow}>
                <ActivityIndicator size="small" color="#a78bfa" />
                <Text style={styles.spinnerText}>
                  {liveStatus ||
                    (state === "researching"
                      ? "Analizuję zapytanie..."
                      : "Przetwarzam...")}
                </Text>
              </View>
            </View>
          )}

          {state === "listening" && transcript ? (
            <View style={styles.transcriptInline}>
              <Text style={styles.transcriptText}>{transcript}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Input row */}
        <View style={styles.textRow}>
          <TextInput
            style={styles.textInput}
            value={textInput}
            onChangeText={setTextInput}
            placeholder={
              state === "listening" ? "Słucham..." : "Wpisz komendę..."
            }
            placeholderTextColor="#475569"
            onSubmitEditing={handleSendText}
            returnKeyType="send"
            editable={state !== "processing" && state !== "researching"}
          />
          <Pressable
            style={[
              styles.sendBtn,
              (!textInput.trim() ||
                state === "processing" ||
                state === "researching") &&
                styles.sendBtnDisabled,
            ]}
            onPress={handleSendText}
            disabled={
              !textInput.trim() ||
              state === "processing" ||
              state === "researching"
            }
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </Pressable>
        </View>

        {/* Voice button */}
        <View style={styles.buttonContainer}>
          <Pressable
            onPress={toggle}
            disabled={
              state === "processing" ||
              state === "researching" ||
              !voiceAvailable
            }
            style={({ pressed }) => [
              styles.voiceButton,
              { backgroundColor: voiceAvailable ? config.color : "#334155" },
              { opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={styles.voiceButtonText}>
              {voiceAvailable ? config.label : "🎤"}
            </Text>
          </Pressable>
          <Text style={styles.stateLabel}>
            {!voiceAvailable && "Mikrofon tylko w APK"}
            {voiceAvailable &&
              state === "idle" &&
              `${model === "claude-sonnet-4-6" ? "Sonnet" : "Haiku"} · naciśnij żeby mówić`}
            {voiceAvailable && state === "listening" && "Słucham..."}
            {voiceAvailable &&
              (state === "processing" || state === "researching") &&
              "Przetwarzam..."}
            {voiceAvailable && state === "speaking" && "Mówię..."}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Styles
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  title: { fontSize: 18, fontWeight: "700", color: "#f1f5f9" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  newBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "#1e3a5f",
    justifyContent: "center",
    alignItems: "center",
  },
  newBtnText: { color: "#60a5fa", fontSize: 16, fontWeight: "700" },
  historyBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "#1e293b",
    justifyContent: "center",
    alignItems: "center",
  },
  historyBtnText: { fontSize: 16 },

  // Model picker
  modelPicker: {
    flexDirection: "row",
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 2,
  },
  modelBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  modelBtnActive: { backgroundColor: "#0891b2" },
  modelBtnText: { color: "#64748b", fontSize: 12, fontWeight: "600" },
  modelBtnTextActive: { color: "#fff" },

  // Log
  logContainer: { flex: 1 },
  logContent: { padding: 16, paddingBottom: 24 },
  logItem: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  logRole: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "600",
    marginBottom: 4,
  },
  logText: { color: "#e2e8f0", fontSize: 15, lineHeight: 23 },
  logTime: { color: "#475569", fontSize: 10, marginTop: 6 },

  // Footnotes
  footnote: {
    color: "#06b6d4",
    fontWeight: "600",
    fontSize: 12,
    backgroundColor: "#06b6d420",
    paddingHorizontal: 2,
    borderRadius: 3,
  },

  liveStatusBox: {
    backgroundColor: "#1e1b4b",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#8b5cf6",
  },

  // Source tooltip
  sourceTooltip: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    borderLeftWidth: 3,
    borderLeftColor: "#06b6d4",
  },
  sourceTooltipTitle: { color: "#e2e8f0", fontSize: 12, fontWeight: "600" },
  sourceTooltipUrl: { color: "#06b6d4", fontSize: 11, marginTop: 2 },

  // Sources bibliography
  sourcesContainer: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
  },
  sourcesTitle: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 6,
  },
  sourceItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    gap: 8,
  },
  sourceIndex: { color: "#06b6d4", fontSize: 11, fontWeight: "700", width: 24 },
  sourceText: { flex: 1 },
  sourceTitle: { color: "#cbd5e1", fontSize: 12, fontWeight: "500" },
  sourceUrl: { color: "#475569", fontSize: 10, marginTop: 1 },
  sourceArrow: { color: "#06b6d4", fontSize: 12 },

  // Research log
  researchLog: {
    backgroundColor: "#1e1b4b",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#8b5cf6",
  },
  researchLogTitle: {
    color: "#a78bfa",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 6,
  },
  researchLogLine: { color: "#c4b5fd", fontSize: 11, lineHeight: 18 },

  // Stats
  statsDetail: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  statsDetailText: {
    color: "#64748b",
    fontSize: 10,
    marginBottom: 2,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // Spinner
  spinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingLeft: 4,
  },
  spinnerText: { color: "#a78bfa", fontSize: 13 },

  // Transcript
  transcriptInline: {
    paddingLeft: 14,
    paddingVertical: 6,
    borderLeftWidth: 2,
    borderLeftColor: "#06b6d440",
  },
  transcriptText: {
    color: "#06b6d4",
    fontSize: 14,
    fontStyle: "italic",
    opacity: 0.7,
  },

  // Empty state
  emptyContainer: { alignItems: "center", paddingTop: 50 },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#f1f5f9",
    marginBottom: 6,
  },
  emptyText: {
    color: "#64748b",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  examplesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 20,
    paddingHorizontal: 10,
  },
  exampleChip: {
    backgroundColor: "#1e293b",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  exampleText: { color: "#94a3b8", fontSize: 12 },

  // Input
  textRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
  },
  textInput: {
    flex: 1,
    backgroundColor: "#1e293b",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: "#f1f5f9",
    fontSize: 15,
    marginRight: 8,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#0891b2",
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: { backgroundColor: "#334155" },
  sendBtnText: { color: "#fff", fontSize: 20, fontWeight: "bold" },

  // Voice button
  buttonContainer: {
    alignItems: "center",
    paddingVertical: 16,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
  },
  voiceButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
  },
  voiceButtonText: { fontSize: 32 },
  stateLabel: { color: "#94a3b8", fontSize: 12, marginTop: 10 },
});
