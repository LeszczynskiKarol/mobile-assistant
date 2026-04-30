import { useState, useRef, useCallback, useEffect } from "react";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import {
  sendVoiceCommand,
  VoiceResponse,
  VoiceStats,
  Source,
  ModelId,
} from "../services/api";

let Voice: any = null;
try {
  Voice = require("@react-native-voice/voice").default;
} catch (e) {
  console.warn("Voice module niedostępny (Expo Go)");
}

function cleanForTTS(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold** → bold
    .replace(/\*(.+?)\*/g, "$1") // *italic* → italic
    .replace(/#{1,6}\s/g, "") // ### heading → heading
    .replace(/\[(\d+)\]/g, "") // [1] [2] → usunięte
    .replace(/\s{2,}/g, " ") // podwójne spacje
    .trim();
}

export type VoiceState =
  | "idle"
  | "listening"
  | "processing"
  | "researching"
  | "speaking";

export interface LogEntry {
  id: string;
  type: "user" | "assistant" | "action" | "error" | "research-status";
  text: string;
  timestamp: Date;
  actions?: VoiceResponse["actions"];
  stats?: VoiceStats;
  sources?: Source[];
  didResearch?: boolean;
}

export function useVoiceAssistant() {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelId>("claude-haiku-4-5");
  const [researchStatus, setResearchStatus] = useState<string>("");
  const [voiceAvailable] = useState(() => Voice !== null);
  const isMounted = useRef(true);

  useEffect(() => {
    if (!Voice) return;
    Voice.onSpeechResults = (e: any) => setTranscript(e.value?.[0] || "");
    Voice.onSpeechPartialResults = (e: any) =>
      setTranscript(e.value?.[0] || "");
    Voice.onSpeechError = (e: any) => {
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
      stats?: VoiceStats,
      actions?: VoiceResponse["actions"],
      sources?: Source[],
      didResearch?: boolean,
    ) => {
      setLog((p) => [
        ...p,
        {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          type,
          text,
          timestamp: new Date(),
          stats,
          actions,
          sources,
          didResearch,
        },
      ]);
    },
    [],
  );

  const processText = useCallback(
    async (text: string) => {
      if (!text.trim() || state === "processing" || state === "researching")
        return;

      addLog("user", text);
      setState("processing");
      setResearchStatus("");

      try {
        const response = await sendVoiceCommand(
          text,
          conversationId || undefined,
          model,
        );
        if (!isMounted.current) return;

        if (response.conversationId) setConversationId(response.conversationId);

        // Pokaż status researchu jeśli był
        if (response.didResearch && response.researchStatus?.length) {
          // Dodaj podsumowanie researchu jako log entry
          addLog("research-status", response.researchStatus.join("\n"));
        }

        addLog(
          "assistant",
          response.response,
          response.stats,
          response.actions,
          response.sources,
          response.didResearch,
        );

        for (const a of response.actions || []) {
          if (a.status === "success")
            addLog(
              "action",
              `✅ ${a.action}: ${JSON.stringify(a.result).slice(0, 100)}`,
            );
          else if (a.status === "error")
            addLog("error", `❌ ${a.action}: ${a.error}`);
        }

        setState("speaking");
        await new Promise<void>((resolve) => {
          Speech.speak(cleanForTTS(response.response), {
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
        addLog("error", `Błąd: ${err.message}`);
        setState("idle");
      }
    },
    [addLog, conversationId, model, state],
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

  const newConversation = useCallback(() => {
    setLog([]);
    setConversationId(null);
    setResearchStatus("");
  }, []);

  const loadConversation = useCallback(
    (
      id: string,
      messages: { role: string; content: string; stats?: VoiceStats }[],
    ) => {
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
    model,
    researchStatus,
    setModel,
    toggle,
    startListening,
    stopListening,
    processText,
    newConversation,
    loadConversation,
    voiceAvailable,
  };
}
