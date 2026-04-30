import { useState, useRef, useCallback, useEffect } from "react";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import {
  sendVoiceCommand,
  VoiceResponse,
  HistoryMessage,
} from "../services/api";

// Bezpieczny import — w Expo Go Voice nie istnieje
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
}

export function useVoiceAssistant() {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [voiceAvailable] = useState(() => Voice !== null);
  const historyRef = useRef<HistoryMessage[]>([]);
  const isMounted = useRef(true);

  useEffect(() => {
    if (!Voice) return;

    Voice.onSpeechResults = (e: any) => {
      const text = e.value?.[0] || "";
      setTranscript(text);
    };
    Voice.onSpeechPartialResults = (e: any) => {
      const text = e.value?.[0] || "";
      setTranscript(text);
    };
    Voice.onSpeechError = (e: any) => {
      console.error("Speech error:", e.error);
      if (isMounted.current) {
        setState("idle");
        addLog(
          "error",
          `Błąd rozpoznawania mowy: ${e.error?.message || "unknown"}`,
        );
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
    ) => {
      setLog((prev) => [
        ...prev,
        {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          type,
          text,
          timestamp: new Date(),
          actions,
        },
      ]);
    },
    [],
  );

  // Przetwarza tekst (używane i przez głos i przez klawiaturę)
  const processText = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      addLog("user", text);
      historyRef.current.push({ role: "user", content: text });

      setState("processing");

      try {
        const response = await sendVoiceCommand(
          text,
          historyRef.current.slice(-10),
        );
        if (!isMounted.current) return;

        addLog("assistant", response.response, response.actions);
        historyRef.current.push({
          role: "assistant",
          content: response.response,
        });

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
    [addLog],
  );

  const startListening = useCallback(async () => {
    if (!Voice) {
      addLog(
        "error",
        "Mikrofon niedostępny w Expo Go — użyj pola tekstowego ⌨️",
      );
      return;
    }
    try {
      Speech.stop();
      setTranscript("");
      setState("listening");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await Voice.start("pl-PL");
    } catch (err) {
      console.error("Start listening error:", err);
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
    } catch (err) {
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

  const clearHistory = useCallback(() => {
    setLog([]);
    historyRef.current = [];
  }, []);

  return {
    state,
    transcript,
    log,
    toggle,
    startListening,
    stopListening,
    processText, // ← eksportujemy do użycia z klawiatury
    clearHistory,
    voiceAvailable, // ← informuje UI czy mikrofon działa
  };
}
