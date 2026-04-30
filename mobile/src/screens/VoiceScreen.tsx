import { useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { useVoiceAssistant, VoiceState, LogEntry } from '../hooks/useVoiceAssistant';

const STATE_CONFIG: Record<VoiceState, { label: string; color: string; pulse: boolean }> = {
  idle:       { label: '🎤', color: '#1e293b', pulse: false },
  listening:  { label: '🔴', color: '#dc2626', pulse: true },
  processing: { label: '⏳', color: '#f59e0b', pulse: true },
  speaking:   { label: '🔊', color: '#2563eb', pulse: false },
};

function LogItem({ entry }: { entry: LogEntry }) {
  const colors: Record<string, string> = {
    user: '#60a5fa',
    assistant: '#f1f5f9',
    action: '#4ade80',
    error: '#f87171',
  };

  const prefixes: Record<string, string> = {
    user: '🗣️ ',
    assistant: '🤖 ',
    action: '',
    error: '',
  };

  return (
    <View style={[styles.logItem, { borderLeftColor: colors[entry.type] }]}>
      <Text style={styles.logText}>
        {prefixes[entry.type]}{entry.text}
      </Text>
      <Text style={styles.logTime}>
        {entry.timestamp.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </Text>
    </View>
  );
}

export default function VoiceScreen() {
  const { state, transcript, log, toggle, clearHistory } = useVoiceAssistant();
  const scrollRef = useRef<ScrollView>(null);
  const config = STATE_CONFIG[state];

  // Auto-scroll do dołu
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [log.length]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Voice Assistant</Text>
        <Pressable onPress={clearHistory} style={styles.clearBtn}>
          <Text style={styles.clearText}>Wyczyść</Text>
        </Pressable>
      </View>

      {/* Log */}
      <ScrollView
        ref={scrollRef}
        style={styles.logContainer}
        contentContainerStyle={styles.logContent}
      >
        {log.length === 0 && (
          <Text style={styles.emptyText}>
            Naciśnij przycisk i powiedz co mam zrobić.{'\n\n'}
            Przykłady:{'\n'}
            • "Utwórz kartę w Trello: naprawić bug na stronie"{'\n'}
            • "Wyślij maila do Jana z podsumowaniem spotkania"{'\n'}
            • "Dodaj wydarzenie jutro o 14 — spotkanie z klientem"{'\n'}
            • "Co mam w kalendarzu na ten tydzień?"
          </Text>
        )}
        {log.map(entry => (
          <LogItem key={entry.id} entry={entry} />
        ))}
      </ScrollView>

      {/* Transcript (live) */}
      {state === 'listening' && transcript ? (
        <View style={styles.transcriptBar}>
          <Text style={styles.transcriptText}>{transcript}</Text>
        </View>
      ) : null}

      {/* Voice button */}
      <View style={styles.buttonContainer}>
        <Pressable
          onPress={toggle}
          disabled={state === 'processing'}
          style={({ pressed }) => [
            styles.voiceButton,
            { backgroundColor: config.color, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={styles.voiceButtonText}>{config.label}</Text>
        </Pressable>
        <Text style={styles.stateLabel}>
          {state === 'idle' && 'Naciśnij, żeby mówić'}
          {state === 'listening' && 'Słucham...'}
          {state === 'processing' && 'Przetwarzam...'}
          {state === 'speaking' && 'Mówię... (naciśnij żeby przerwać)'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1e293b',
  },
  clearText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  logContainer: {
    flex: 1,
  },
  logContent: {
    padding: 16,
    paddingBottom: 24,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
    marginTop: 40,
  },
  logItem: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  logText: {
    color: '#e2e8f0',
    fontSize: 15,
    lineHeight: 22,
  },
  logTime: {
    color: '#475569',
    fontSize: 11,
    marginTop: 4,
  },
  transcriptBar: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  transcriptText: {
    color: '#60a5fa',
    fontSize: 15,
    fontStyle: 'italic',
  },
  buttonContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  voiceButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  voiceButtonText: {
    fontSize: 36,
  },
  stateLabel: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 12,
  },
});
