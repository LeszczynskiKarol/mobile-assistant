import { useRef, useEffect, useState, useCallback } from "react";
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
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  useVoiceAssistant,
  VoiceState,
  LogEntry,
} from "../hooks/useVoiceAssistant";
import { getConversation } from "../services/api";

const STATE_CONFIG: Record<VoiceState, { label: string; color: string }> = {
  idle: { label: "🎤", color: "#1e293b" },
  listening: { label: "🔴", color: "#dc2626" },
  processing: { label: "⏳", color: "#f59e0b" },
  speaking: { label: "🔊", color: "#2563eb" },
};

function LogItem({ entry }: { entry: LogEntry }) {
  const [showStats, setShowStats] = useState(false);
  const colors: Record<string, string> = {
    user: "#60a5fa",
    assistant: "#f1f5f9",
    action: "#4ade80",
    error: "#f87171",
  };
  const prefixes: Record<string, string> = {
    user: "🗣️ ",
    assistant: "🤖 ",
    action: "",
    error: "",
  };

  return (
    <Pressable
      style={[styles.logItem, { borderLeftColor: colors[entry.type] }]}
      onPress={() => entry.stats && setShowStats(!showStats)}
    >
      <Text style={styles.logText}>
        {prefixes[entry.type]}
        {entry.text}
      </Text>

      {/* Statystyki per-wiadomość (tap to toggle) */}
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

export default function VoiceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const {
    state,
    transcript,
    log,
    conversationId,
    toggle,
    newConversation,
    loadConversation,
    processText,
    voiceAvailable,
  } = useVoiceAssistant();
  const scrollRef = useRef<ScrollView>(null);
  const config = STATE_CONFIG[state];
  const [textInput, setTextInput] = useState("");

  // Załaduj istniejącą konwersację z parametrów
  useEffect(() => {
    if (params.conversationId) {
      getConversation(params.conversationId).then((data) => {
        loadConversation(
          data.id,
          data.messages.map((m) => ({
            role: m.role,
            content: m.content,
            stats: m.inputTokens != null
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
    if (!text || state === "processing") return;
    setTextInput("");
    await processText(text);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Voice Assistant</Text>
        <View style={styles.headerRight}>
          {conversationId && (
            <Pressable onPress={newConversation} style={styles.newBtn}>
              <Text style={styles.newBtnText}>+ Nowa</Text>
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
            <Text style={styles.emptyText}>
              {voiceAvailable
                ? "Naciśnij przycisk i powiedz co mam zrobić."
                : "Wpisz komendę w pole poniżej."}
              {"\n\nPrzykłady:\n"}
              {'• "Utwórz kartę w Trello: naprawić bug"\n'}
              {'• "Wyślij maila do Jana z podsumowaniem"\n'}
              {'• "Dodaj wydarzenie jutro o 14"\n'}
              {'• "Co mam w kalendarzu na ten tydzień?"'}
            </Text>
          )}
          {log.map((entry) => (
            <LogItem key={entry.id} entry={entry} />
          ))}
        </ScrollView>

        {state === "listening" && transcript ? (
          <View style={styles.transcriptBar}>
            <Text style={styles.transcriptText}>{transcript}</Text>
          </View>
        ) : null}

        {/* Text input */}
        <View style={styles.textRow}>
          <TextInput
            style={styles.textInput}
            value={textInput}
            onChangeText={setTextInput}
            placeholder="Wpisz komendę..."
            placeholderTextColor="#475569"
            onSubmitEditing={handleSendText}
            returnKeyType="send"
            editable={state !== "processing"}
          />
          <Pressable
            style={[
              styles.sendBtn,
              (!textInput.trim() || state === "processing") &&
                styles.sendBtnDisabled,
            ]}
            onPress={handleSendText}
            disabled={!textInput.trim() || state === "processing"}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </Pressable>
        </View>

        {/* Voice button */}
        <View style={styles.buttonContainer}>
          <Pressable
            onPress={toggle}
            disabled={state === "processing" || !voiceAvailable}
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
            {voiceAvailable && state === "idle" && "Naciśnij, żeby mówić"}
            {voiceAvailable && state === "listening" && "Słucham..."}
            {voiceAvailable && state === "processing" && "Przetwarzam..."}
            {voiceAvailable && state === "speaking" && "Mówię..."}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

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
  title: { fontSize: 20, fontWeight: "700", color: "#f1f5f9" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  newBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#1e3a5f",
  },
  newBtnText: { color: "#60a5fa", fontSize: 13, fontWeight: "600" },
  historyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#1e293b",
  },
  historyBtnText: { fontSize: 18 },
  logContainer: { flex: 1 },
  logContent: { padding: 16, paddingBottom: 24 },
  emptyText: {
    color: "#64748b",
    fontSize: 15,
    lineHeight: 24,
    textAlign: "center",
    marginTop: 40,
  },
  logItem: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  logText: { color: "#e2e8f0", fontSize: 15, lineHeight: 22 },
  logTime: { color: "#475569", fontSize: 11, marginTop: 4 },
  statsDetail: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  statsDetailText: { color: "#64748b", fontSize: 11, marginBottom: 2 },
  transcriptBar: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  transcriptText: { color: "#60a5fa", fontSize: 15, fontStyle: "italic" },
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
    backgroundColor: "#3b82f6",
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: { backgroundColor: "#334155" },
  sendBtnText: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  buttonContainer: {
    alignItems: "center",
    paddingVertical: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
  },
  voiceButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
  },
  voiceButtonText: { fontSize: 36 },
  stateLabel: { color: "#94a3b8", fontSize: 13, marginTop: 12 },
});
