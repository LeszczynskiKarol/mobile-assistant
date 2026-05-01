import { useRef, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Linking,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
  // Parse markdown + footnotes into styled segments
  const segments: React.ReactNode[] = [];
  const lines = text.split("\n");

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) segments.push(<Text key={`br-${lineIdx}`}>{"\n"}</Text>);

    // Headings
    const h2 = line.match(/^##\s+(.+)/);
    const h1 = !h2 && line.match(/^#\s+(.+)/);

    if (h1) {
      segments.push(
        <Text key={`h1-${lineIdx}`} style={styles.mdH1}>
          {parseInline(h1[1], sources, onSourcePress, `h1-${lineIdx}`)}
        </Text>,
      );
      return;
    }
    if (h2) {
      segments.push(
        <Text key={`h2-${lineIdx}`} style={styles.mdH2}>
          {parseInline(h2[1], sources, onSourcePress, `h2-${lineIdx}`)}
        </Text>,
      );
      return;
    }

    // Bullet points
    const bullet = line.match(/^[-•]\s+(.+)/);
    if (bullet) {
      segments.push(
        <Text key={`li-${lineIdx}`} style={styles.mdLi}>
          {"  • "}
          {parseInline(bullet[1], sources, onSourcePress, `li-${lineIdx}`)}
        </Text>,
      );
      return;
    }

    // Regular line
    segments.push(
      <Text key={`p-${lineIdx}`} style={styles.logText}>
        {parseInline(line, sources, onSourcePress, `p-${lineIdx}`)}
      </Text>,
    );
  });

  return <Text style={styles.logText}>{segments}</Text>;
}

// Parse inline: **bold**, *italic*, [1] footnotes
function parseInline(
  text: string,
  sources?: Source[],
  onSourcePress?: (s: Source) => void,
  keyPrefix = "",
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match **bold**, *italic*, [N] footnotes
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|\[(\d+)\]|(https?:\/\/[^\s]+))/g;
  let lastIdx = 0;
  let match;
  let i = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(
        <Text key={`${keyPrefix}-t${i++}`}>
          {text.slice(lastIdx, match.index)}
        </Text>,
      );
    }

    if (match[2]) {
      // **bold**
      parts.push(
        <Text key={`${keyPrefix}-b${i++}`} style={styles.mdBold}>
          {match[2]}
        </Text>,
      );
    } else if (match[3]) {
      // *italic*
      parts.push(
        <Text key={`${keyPrefix}-i${i++}`} style={styles.mdItalic}>
          {match[3]}
        </Text>,
      );
    } else if (match[4]) {
      // [N] footnote
      const idx = parseInt(match[4]);
      const source = sources?.find((s) => s.index === idx);
      parts.push(
        <Text
          key={`${keyPrefix}-fn${i++}`}
          style={styles.footnote}
          onPress={() =>
            source &&
            (onSourcePress
              ? onSourcePress(source)
              : Linking.openURL(source.url))
          }
        >
          [{match[4]}]
        </Text>,
      );
    } else if (match[5]) {
      const url = match[5];
      parts.push(
        <Text
          key={`${keyPrefix}-url${i++}`}
          style={{ color: "#06b6d4" }}
          onPress={() => Linking.openURL(url)}
        >
          {url.length > 40 ? url.slice(0, 40) + "…" : url}
        </Text>,
      );
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(<Text key={`${keyPrefix}-end`}>{text.slice(lastIdx)}</Text>);
  }

  return parts;
}

// ── Action Bubble (mobile) ────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  // Trello
  trello_create_card: "📋 Trello — nowa karta",
  trello_board: "📋 Trello — przegląd boardu",
  trello_boards: "📋 Trello — lista boardów",
  trello_list_cards: "📋 Trello — karty na liście",
  trello_get_card: "📋 Trello — szczegóły karty",
  trello_search: "📋 Trello — wyszukiwanie",
  trello_move_card: "📋 Trello — przeniesienie karty",
  trello_update_card: "📋 Trello — edycja karty",
  trello_create_board: "📋 Trello — nowy board",
  trello_create_list: "📋 Trello — nowa lista",
  trello_comment: "📋 Trello — komentarz",
  trello_archive: "📋 Trello — archiwizacja",
  trello_delete: "📋 Trello — usunięcie karty",
  trello_checklist: "📋 Trello — checklista",
  trello_toggle_check: "📋 Trello — checkbox",
  trello_activity: "📋 Trello — aktywność",
  // Gmail
  gmail_send: "📧 Gmail — wysłanie",
  gmail_draft: "📧 Gmail — draft",
  gmail_reply: "📧 Gmail — odpowiedź",
  gmail_forward: "📧 Gmail — przekazanie",
  gmail_list: "📧 Gmail — lista emaili",
  gmail_read: "📧 Gmail — odczyt emaila",
  gmail_search: "📧 Gmail — wyszukiwanie",
  gmail_thread: "📧 Gmail — wątek",
  gmail_trash: "📧 Gmail — kosz",
  gmail_untrash: "📧 Gmail — przywrócenie",
  gmail_mark_read: "📧 Gmail — oznaczenie",
  gmail_star: "📧 Gmail — gwiazdka",
  gmail_labels: "📧 Gmail — etykiety",
  gmail_modify_labels: "📧 Gmail — zmiana etykiet",
  gmail_batch_modify: "📧 Gmail — operacja zbiorcza",
  gmail_profile: "📧 Gmail — profil",
  gmail_send_attachment: "📧 Gmail — email z załącznikiem",
  // Calendar
  calendar_create: "📅 Kalendarz — nowe wydarzenie",
  calendar_list: "📅 Kalendarz — lista wydarzeń",
  calendar_get: "📅 Kalendarz — szczegóły",
  calendar_update: "📅 Kalendarz — edycja",
  calendar_delete: "📅 Kalendarz — usunięcie",
  calendar_search: "📅 Kalendarz — wyszukiwanie",
  calendar_quick_add: "📅 Kalendarz — szybkie dodanie",
  calendar_calendars: "📅 Kalendarz — lista kalendarzy",
  calendar_move: "📅 Kalendarz — przeniesienie",
  calendar_attach: "📅 Kalendarz — załącznik",
  calendar_create_calendar: "📅 Kalendarz — nowy kalendarz",
  calendar_delete_calendar: "📅 Kalendarz — usunięcie kalendarza",
  // Contacts
  contacts_search: "👤 Kontakty — wyszukiwanie",
  contacts_list: "👤 Kontakty — lista",
  contacts_email: "👤 Kontakty — szukanie emaila",
  contacts_gmail: "👤 Kontakty — historia Gmail",
  // Drive
  drive_search: "💾 Drive — wyszukiwanie",
  drive_recent: "💾 Drive — ostatnie pliki",
  drive_file: "💾 Drive — szczegóły pliku",
  drive_folder: "💾 Drive — folder",
  drive_storage: "💾 Drive — pojemność",
  drive_read: "💾 Drive — odczyt pliku",
  drive_share: "💾 Drive — udostępnienie",
  drive_export: "💾 Drive — eksport",
  drive_trash: "💾 Drive — kosz",
  drive_untrash: "💾 Drive — przywrócenie",
  drive_delete: "💾 Drive — usunięcie",
  drive_batch_trash: "💾 Drive — masowy kosz",
  drive_empty_trash: "💾 Drive — opróżnienie kosza",
  drive_update: "💾 Drive — edycja metadanych",
  drive_move: "💾 Drive — przeniesienie",
  drive_create_folder: "💾 Drive — nowy folder",
  // Other
  reminder: "⏰ Przypomnienie",
  note: "📝 Notatka",
  web_search: "🔍 Wyszukiwanie",
};

function ActionRow({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: string;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={actionStyles.row}>
      <Text style={actionStyles.rowIcon}>{icon}</Text>
      <Text style={actionStyles.rowLabel}>{label}:</Text>
      <Text
        style={[actionStyles.rowValue, mono && actionStyles.rowMono]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function BodyPreviewMobile({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  const preview = body.split("\n").find((l) => l.trim()) ?? body.slice(0, 60);
  const hasMore = body.trim().length > preview.length + 5;

  return (
    <View style={actionStyles.bodyContainer}>
      <Text style={actionStyles.bodyLabel}>✉️ Treść:</Text>
      <View style={actionStyles.bodyBox}>
        {open ? (
          <Text style={actionStyles.bodyText}>{body}</Text>
        ) : (
          <Text style={actionStyles.bodyPreview}>
            {preview}
            {hasMore ? "…" : ""}
          </Text>
        )}
        {hasMore && (
          <Pressable
            onPress={() => setOpen(!open)}
            style={actionStyles.bodyToggle}
          >
            <Text style={actionStyles.bodyToggleText}>
              {open ? "zwiń ▲" : "pokaż więcej ▼"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ActionBubble({
  text,
  type,
}: {
  text: string;
  type: "action" | "error";
}) {
  const [expanded, setExpanded] = useState(false);

  if (type === "error") {
    return (
      <View style={actionStyles.errorBox}>
        <Text style={actionStyles.errorText}>{text}</Text>
      </View>
    );
  }

  const match = text.match(/^✅ ([\w_]+): (.+)$/s);
  if (!match) {
    return (
      <View style={actionStyles.successBox}>
        <Text style={actionStyles.successText}>{text}</Text>
      </View>
    );
  }

  const actionName = match[1];
  const label = ACTION_LABELS[actionName] ?? `⚙️ ${actionName}`;
  let parsed: any = null;
  try {
    parsed = JSON.parse(match[2]);
  } catch {}

  const renderDetails = () => {
    if (!parsed)
      return <Text style={actionStyles.fallbackText}>{match[2]}</Text>;

    if (
      ["gmail_send", "gmail_draft", "gmail_reply", "gmail_forward"].includes(
        actionName,
      )
    ) {
      return (
        <View style={actionStyles.details}>
          {parsed.to && <ActionRow icon="→" label="Do" value={parsed.to} />}
          {parsed.subject && (
            <ActionRow icon="📌" label="Temat" value={parsed.subject} />
          )}
          {parsed.body && <BodyPreviewMobile body={parsed.body} />}
          {parsed.messageId && (
            <ActionRow icon="🆔" label="ID" value={parsed.messageId} mono />
          )}
        </View>
      );
    }

    if (actionName === "trello_board") {
      const board = parsed.board;
      const lists: any[] = parsed.lists || [];
      const totalCards = lists.reduce(
        (sum: number, l: any) => sum + (l.cards?.length || 0),
        0,
      );
      return (
        <View style={actionStyles.details}>
          {board?.name && (
            <ActionRow icon="📋" label="Board" value={board.name} />
          )}
          {board?.url && (
            <Pressable onPress={() => Linking.openURL(board.url)}>
              <Text style={actionStyles.link}>↗ Otwórz w Trello</Text>
            </Pressable>
          )}
          {board?.lastActivity && (
            <ActionRow
              icon="🕐"
              label="Aktywność"
              value={new Date(board.lastActivity).toLocaleDateString("pl-PL")}
            />
          )}
          <ActionRow
            icon="📊"
            label="Listy"
            value={`${lists.length} | ${totalCards} kart`}
          />
          {lists.map((list: any) => (
            <View key={list.id} style={{ marginTop: 6 }}>
              <Text
                style={{ color: "#86efac", fontSize: 12, fontWeight: "600" }}
              >
                📋 {list.name} ({list.cards?.length || 0})
              </Text>
              {list.cards?.map((card: any) => (
                <Pressable
                  key={card.id}
                  onPress={() => card.url && Linking.openURL(card.url)}
                  style={{
                    paddingLeft: 10,
                    borderLeftWidth: 1,
                    borderLeftColor: "#14532d",
                    marginTop: 3,
                  }}
                >
                  <Text style={{ color: "#cbd5e1", fontSize: 11 }}>
                    📝 {card.name}
                  </Text>
                  {card.description ? (
                    <Text
                      style={{ color: "#6b7280", fontSize: 10 }}
                      numberOfLines={1}
                    >
                      {card.description.slice(0, 60)}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
              {(!list.cards || list.cards.length === 0) && (
                <Text
                  style={{
                    color: "#4b5563",
                    fontSize: 10,
                    paddingLeft: 10,
                    fontStyle: "italic",
                  }}
                >
                  pusta
                </Text>
              )}
            </View>
          ))}
        </View>
      );
    }

    if (actionName === "gmail_profile") {
      return (
        <View style={actionStyles.details}>
          {parsed.email && (
            <ActionRow icon="📧" label="Konto" value={parsed.email} />
          )}
          {parsed.messagesTotal != null && (
            <ActionRow
              icon="📨"
              label="Wiadomości"
              value={parsed.messagesTotal.toLocaleString()}
            />
          )}
          {parsed.threadsTotal != null && (
            <ActionRow
              icon="🧵"
              label="Wątki"
              value={parsed.threadsTotal.toLocaleString()}
            />
          )}
        </View>
      );
    }

    if (actionName === "trello_create_card") {
      return (
        <View style={actionStyles.details}>
          {parsed.name && (
            <ActionRow icon="📋" label="Tytuł" value={parsed.name} />
          )}
          {parsed.url && (
            <Pressable onPress={() => Linking.openURL(parsed.url)}>
              <Text style={actionStyles.link}>↗ Otwórz kartę</Text>
            </Pressable>
          )}
        </View>
      );
    }

    if (actionName === "calendar_create") {
      return (
        <View style={actionStyles.details}>
          {parsed.summary && (
            <ActionRow icon="📅" label="Tytuł" value={parsed.summary} />
          )}
          {parsed.start?.dateTime && (
            <ActionRow
              icon="🕐"
              label="Start"
              value={new Date(parsed.start.dateTime).toLocaleString("pl-PL")}
            />
          )}
        </View>
      );
    }

    if (actionName === "calendar_list" || actionName === "calendar_search") {
      const events = parsed.events || parsed;
      if (Array.isArray(events)) {
        return (
          <View style={actionStyles.details}>
            {events.map((ev: any, i: number) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <ActionRow
                  icon="📅"
                  label="Wydarzenie"
                  value={ev.title || ev.summary || "?"}
                />
                {ev.start && (
                  <ActionRow
                    icon="🕐"
                    label="Start"
                    value={new Date(ev.start).toLocaleString("pl-PL")}
                  />
                )}
                {ev.location && (
                  <ActionRow icon="📍" label="Miejsce" value={ev.location} />
                )}
              </View>
            ))}
          </View>
        );
      }
    }

    if (actionName === "calendar_calendars") {
      const cals = parsed.calendars || [];
      return (
        <View style={actionStyles.details}>
          {cals.map((c: any, i: number) => (
            <ActionRow
              key={i}
              icon={c.primary ? "⭐" : "📅"}
              label={c.name}
              value={c.accessRole}
            />
          ))}
        </View>
      );
    }

    if (actionName === "contacts_email") {
      return (
        <View style={actionStyles.details}>
          {parsed.name && (
            <ActionRow icon="👤" label="Kontakt" value={parsed.name} />
          )}
          {parsed.email && (
            <ActionRow icon="📧" label="Email" value={parsed.email} />
          )}
        </View>
      );
    }

    if (actionName?.startsWith("drive_")) {
      return (
        <View style={actionStyles.details}>
          {parsed.name && (
            <ActionRow icon="📄" label="Plik" value={parsed.name} />
          )}
          {parsed.fileId && (
            <ActionRow icon="🆔" label="ID" value={parsed.fileId} mono />
          )}
          {parsed.trashed !== undefined && (
            <ActionRow
              icon="🗑"
              label="Status"
              value={parsed.trashed ? "W koszu" : "Przywrócono"}
            />
          )}
          {parsed.deleted && (
            <ActionRow icon="❌" label="Status" value="Usunięto na stałe" />
          )}
          {parsed.sharedWith && (
            <ActionRow
              icon="👥"
              label="Udostępniono"
              value={parsed.sharedWith}
            />
          )}
          {parsed.link && (
            <Pressable onPress={() => Linking.openURL(parsed.link)}>
              <Text style={actionStyles.link}>↗ Otwórz</Text>
            </Pressable>
          )}
        </View>
      );
    }

    // Fallback
    return (
      <View style={actionStyles.details}>
        {Object.entries(parsed)
          .slice(0, 6)
          .map(([k, v]) => (
            <ActionRow
              key={k}
              icon="·"
              label={k}
              value={typeof v === "object" ? JSON.stringify(v) : String(v)}
            />
          ))}
      </View>
    );
  };

  return (
    <View style={actionStyles.box}>
      <Pressable
        style={actionStyles.header}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={actionStyles.headerLeft}>
          <Text style={actionStyles.check}>✓</Text>
          <Text style={actionStyles.actionLabel}>{label}</Text>
        </View>
        <Text style={actionStyles.chevron}>{expanded ? "▲" : "▼"}</Text>
      </Pressable>
      {expanded && (
        <View style={actionStyles.expandedBody}>{renderDetails()}</View>
      )}
    </View>
  );
}

const actionStyles = StyleSheet.create({
  box: {
    backgroundColor: "#052e1a",
    borderWidth: 1,
    borderColor: "#166534",
    borderRadius: 12,
    marginBottom: 8,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  check: { color: "#4ade80", fontWeight: "700", fontSize: 14 },
  actionLabel: { color: "#86efac", fontSize: 13, fontWeight: "600" },
  chevron: { color: "#4b5563", fontSize: 11 },
  expandedBody: {
    borderTopWidth: 1,
    borderTopColor: "#14532d",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  details: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowIcon: { fontSize: 12, width: 18 },
  rowLabel: { color: "#6b7280", fontSize: 12, minWidth: 40 },
  rowValue: { color: "#e2e8f0", fontSize: 12, flex: 1 },
  rowMono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
  },
  bodyContainer: { marginTop: 4 },
  bodyLabel: { color: "#6b7280", fontSize: 12, marginBottom: 4 },
  bodyBox: {
    backgroundColor: "#0f2918",
    borderRadius: 8,
    padding: 10,
  },
  bodyText: { color: "#d1fae5", fontSize: 12, lineHeight: 18 },
  bodyPreview: { color: "#9ca3af", fontSize: 12, fontStyle: "italic" },
  bodyToggle: { marginTop: 6 },
  bodyToggleText: { color: "#22d3ee", fontSize: 11, fontWeight: "600" },
  link: { color: "#22d3ee", fontSize: 12, marginTop: 4 },
  fallbackText: {
    color: "#9ca3af",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  errorBox: {
    backgroundColor: "#1f0a0a",
    borderWidth: 1,
    borderColor: "#7f1d1d",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  errorText: {
    color: "#f87171",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  successBox: {
    backgroundColor: "#052e1a",
    borderWidth: 1,
    borderColor: "#166534",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  successText: { color: "#4ade80", fontSize: 12 },
});

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
    return <ActionBubble text={entry.text} type={entry.type} />;
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
          <Pressable onPress={newConversation} style={styles.newBtn}>
            <Text style={styles.newBtnText}>✦ Nowa</Text>
          </Pressable>
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

        {/* Input + voice row */}
        <View style={styles.inputBar}>
          <Pressable
            onPress={toggle}
            disabled={
              state === "processing" ||
              state === "researching" ||
              !voiceAvailable
            }
            style={({ pressed }) => [
              styles.voiceBtn,
              { backgroundColor: voiceAvailable ? config.color : "#334155" },
              { opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Text style={styles.voiceBtnText}>
              {voiceAvailable ? config.label : "🎤"}
            </Text>
          </Pressable>

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
    paddingTop:
      Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) + 8 : 8,

    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  title: { fontSize: 18, fontWeight: "700", color: "#f1f5f9" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  newBtn: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#0c2a3f",
    borderWidth: 1,
    borderColor: "#0891b2",
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  newBtnText: {
    color: "#06b6d4",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
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
  // Input bar (single row: mic + input + send)
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: Platform.OS === "ios" ? 40 : 28,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    gap: 8,
  },

  voiceBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    flexShrink: 0,
  },
  voiceBtnText: { fontSize: 20 },
  textInput: {
    flex: 1,
    backgroundColor: "#1e293b",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#f1f5f9",
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#0891b2",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  sendBtnDisabled: { backgroundColor: "#334155" },
  sendBtnText: { color: "#fff", fontSize: 20, fontWeight: "bold" },

  // Markdown styles
  mdH1: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f1f5f9",
    marginVertical: 4,
  },
  mdH2: {
    fontSize: 16,
    fontWeight: "700",
    color: "#e2e8f0",
    marginVertical: 3,
  },
  mdBold: { fontWeight: "700", color: "#f1f5f9" },
  mdItalic: { fontStyle: "italic", color: "#cbd5e1" },
  mdLi: { color: "#e2e8f0", fontSize: 15, lineHeight: 23, paddingLeft: 4 },
});
