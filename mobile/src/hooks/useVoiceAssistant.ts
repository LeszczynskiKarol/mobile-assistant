import { useState, useRef, useCallback, useEffect } from "react";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import { sendVoiceCommand, VoiceResponse, VoiceStats } from "../services/api";

let Voice: any = null;
try {
  Voice = require("@react-native-voice/voice").default;
} catch (e) {
  console.warn("Voice module niedostępny (Expo Go) — użyj trybu tekstowego");
}

export type VoiceState = "idle" | "listening" | "processing" | "speaking";

export interface LogEntry {
  id: string;
  type: "user" | "assistant" | "action" | "error";
  text: string;
  timestamp: Date;
  actions?: VoiceResponse["actions"];
  stats?: VoiceStats;
}

export function useVoiceAssistant() {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [voiceAvailable] = useState(() => Voice !== null);
  const isMounted = useRef(true);

  useEffect(() => {
    if (!Voice) return;

    Voice.onSpeechResults = (e: any) => {
      setTranscript(e.value?.[0] || "");
    };
    Voice.onSpeechPartialResults = (e: any) => {
      setTranscript(e.value?.[0] || "");
    };
    Voice.onSpeechError = (e: any) => {
      console.error("Speech error:", e.error);
      if (isMounted.current) {
        setState("idle");
        addLog("error", `Błąd mowy: ${e.error?.message || "unknown"}`);
      }
    };

    return () => {
      isMounted.current = false;
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []);

  const addLog = useCallback(
    (
      type: LogEntry["type"],
      text: string,
      actions?: VoiceResponse["actions"],
      stats?: VoiceStats,
    ) => {
      setLog((prev) => [
        ...prev,
        {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          type,
          text,
          timestamp: new Date(),
          actions,
          stats,
        },
      ]);
    },
    [],
  );

  const processText = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      addLog("user", text);
      setState("processing");

      try {
        // Serwer zarządza historią — wysyłamy tylko conversationId
        const response = await sendVoiceCommand(
          text,
          conversationId || undefined,
        );
        if (!isMounted.current) return;

        // Zapisz conversationId (nowy lub istniejący)
        if (response.conversationId) {
          setConversationId(response.conversationId);
        }

        addLog("assistant", response.response, response.actions, response.stats);

        for (const action of response.actions || []) {
          if (action.status === "success") {
            addLog(
              "action",
              `✅ ${action.action}: ${JSON.stringify(action.result).slice(0, 100)}`,
            );
          } else if (action.status === "error") {
            addLog("error", `❌ ${action.action}: ${action.error}`);
          }
        }

        setState("speaking");
        await new Promise<void>((resolve) => {
          Speech.speak(response.response, {
            language: "pl-PL",
            rate: 1.05,
            onDone: resolve,
            onError: () => resolve(),
            onStopped: () => resolve(),
          });
        });

        if (isMounted.current) {
          setState("idle");
          setTranscript("");
        }
      } catch (err: any) {
        console.error("Process error:", err);
        addLog("error", `Błąd: ${err.message}`);
        setState("idle");
      }
    },
    [addLog, conversationId],
  );

  const startListening = useCallback(async () => {
    if (!Voice) {
      addLog("error", "Mikrofon niedostępny w Expo Go ⌨️");
      return;
    }
    try {
      Speech.stop();
      setTranscript("");
      setState("listening");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await Voice.start("pl-PL");
    } catch {
      setState("idle");
    }
  }, [addLog]);

  const stopListening = useCallback(async () => {
    if (!Voice) return;
    try {
      await Voice.stop();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const text = transcript.trim();
      if (!text) {
        setState("idle");
        return;
      }
      await processText(text);
    } catch {
      setState("idle");
    }
  }, [transcript, processText]);

  const toggle = useCallback(() => {
    if (state === "listening") stopListening();
    else if (state === "idle") startListening();
    else if (state === "speaking") {
      Speech.stop();
      setState("idle");
    }
  }, [state, startListening, stopListening]);

  // Nowa konwersacja — reset
  const newConversation = useCallback(() => {
    setLog([]);
    setConversationId(null);
  }, []);

  // Załaduj istniejącą konwersację
  const loadConversation = useCallback(
    (id: string, messages: { role: string; content: string; stats?: VoiceStats }[]) => {
      setConversationId(id);
      const entries: LogEntry[] = messages.map((m, i) => ({
        id: `loaded-${i}-${Date.now().toString(36)}`,
        type: m.role as "user" | "assistant",
        text: m.content,
        timestamp: new Date(),
        stats: m.stats,
      }));
      setLog(entries);
    },
    [],
  );

  return {
    state,
    transcript,
    log,
    conversationId,
    toggle,
    startListening,
    stopListening,
    processText,
    newConversation,
    loadConversation,
    voiceAvailable,
  };
}
