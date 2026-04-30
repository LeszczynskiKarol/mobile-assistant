import { useState, useRef, useCallback, useEffect } from 'react';
import Voice, {
  SpeechResultsEvent,
  SpeechErrorEvent,
} from '@react-native-voice/voice';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { sendVoiceCommand, VoiceResponse, HistoryMessage } from '../services/api';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

export interface LogEntry {
  id: string;
  type: 'user' | 'assistant' | 'action' | 'error';
  text: string;
  timestamp: Date;
  actions?: VoiceResponse['actions'];
}

export function useVoiceAssistant() {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const historyRef = useRef<HistoryMessage[]>([]);
  const isMounted = useRef(true);

  // --- Setup Voice listeners ---
  useEffect(() => {
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const text = e.value?.[0] || '';
      setTranscript(text);
    };

    Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
      const text = e.value?.[0] || '';
      setTranscript(text);
    };

    Voice.onSpeechError = (e: SpeechErrorEvent) => {
      console.error('Speech error:', e.error);
      if (isMounted.current) {
        setState('idle');
        addLog('error', `Błąd rozpoznawania mowy: ${e.error?.message || 'unknown'}`);
      }
    };

    Voice.onSpeechEnd = () => {
      // Automatycznie przetwórz po zakończeniu mówienia
      // (handleStopListening jest wywoływany manualnie)
    };

    return () => {
      isMounted.current = false;
      Voice.destroy().then(Voice.removeAllListeners);
    };
  }, []);

  const addLog = useCallback((type: LogEntry['type'], text: string, actions?: VoiceResponse['actions']) => {
    setLog(prev => [...prev, {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      type,
      text,
      timestamp: new Date(),
      actions,
    }]);
  }, []);

  // --- Start listening ---
  const startListening = useCallback(async () => {
    try {
      Speech.stop(); // Zatrzymaj TTS jeśli mówi
      setTranscript('');
      setState('listening');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      await Voice.start('pl-PL'); // Polski! Darmowy, natywny Android STT
    } catch (err) {
      console.error('Start listening error:', err);
      setState('idle');
    }
  }, []);

  // --- Stop listening and process ---
  const stopListening = useCallback(async () => {
    try {
      await Voice.stop();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const text = transcript.trim();
      if (!text) {
        setState('idle');
        return;
      }

      // Loguj co user powiedział
      addLog('user', text);
      historyRef.current.push({ role: 'user', content: text });

      // Przetwarzaj
      setState('processing');
      const response = await sendVoiceCommand(text, historyRef.current.slice(-10));

      if (!isMounted.current) return;

      // Loguj odpowiedź
      addLog('assistant', response.response, response.actions);
      historyRef.current.push({ role: 'assistant', content: response.response });

      // Loguj wykonane akcje
      for (const action of response.actions) {
        if (action.status === 'success') {
          addLog('action', `✅ ${action.action}: ${JSON.stringify(action.result).slice(0, 100)}`);
        } else if (action.status === 'error') {
          addLog('error', `❌ ${action.action}: ${action.error}`);
        }
      }

      // Odczytaj odpowiedź na głos (darmowy Android TTS)
      setState('speaking');
      await new Promise<void>((resolve) => {
        Speech.speak(response.response, {
          language: 'pl-PL',
          rate: 1.05,            // trochę szybciej niż domyślnie
          onDone: resolve,
          onError: () => resolve(),
          onStopped: () => resolve(),
        });
      });

      if (isMounted.current) {
        setState('idle');
        setTranscript('');
      }

    } catch (err: any) {
      console.error('Process error:', err);
      addLog('error', `Błąd: ${err.message}`);
      setState('idle');
    }
  }, [transcript, addLog]);

  // --- Toggle (dla jednego przycisku) ---
  const toggle = useCallback(() => {
    if (state === 'listening') {
      stopListening();
    } else if (state === 'idle') {
      startListening();
    } else if (state === 'speaking') {
      Speech.stop();
      setState('idle');
    }
    // w stanie 'processing' ignoruj
  }, [state, startListening, stopListening]);

  // --- Wyczyść historię ---
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
    clearHistory,
  };
}
