import { trelloCreateCard, trelloMoveCard } from "../actions/trello.js";
import {
  gmailSend, gmailDraft, gmailList, gmailRead, gmailSearch,
  gmailReply, gmailForward, gmailTrash, gmailUntrash,
  gmailMarkRead, gmailStar, gmailModifyLabels, gmailGetLabels,
  gmailGetThread, gmailBatchModify, gmailProfile,
} from "../actions/gmail.js";
import { calendarCreate, calendarList } from "../actions/calendar.js";
import { createNote } from "../actions/notes.js";

// Rejestr akcji — dodawaj nowe tutaj
export const ACTION_REGISTRY = {
  // ── Trello ──
  trello_create_card: {
    handler: trelloCreateCard,
    description: "Utwórz kartę w Trello",
    params: ["title", "description?", "listId?", "labels?"],
  },
  trello_move_card: {
    handler: trelloMoveCard,
    description: "Przenieś kartę w Trello",
    params: ["cardName", "targetList"],
  },

  // ── Gmail — wysyłanie ──
  gmail_send: {
    handler: gmailSend,
    description: "Wyślij email przez Gmail",
    params: ["to", "subject", "body", "cc?", "htmlBody?"],
  },
  gmail_draft: {
    handler: gmailDraft,
    description: "Utwórz draft w Gmail",
    params: ["to", "subject", "body", "cc?", "htmlBody?"],
  },
  gmail_reply: {
    handler: gmailReply,
    description: "Odpowiedz na email (potrzebny messageId z gmail_list/gmail_read)",
    params: ["messageId", "body", "replyAll?"],
  },
  gmail_forward: {
    handler: gmailForward,
    description: "Prześlij email dalej",
    params: ["messageId", "to", "comment?"],
  },

  // ── Gmail — odczyt ──
  gmail_list: {
    handler: gmailList,
    description: "Lista emaili (inbox, nieprzeczytane, wysłane itp.)",
    params: ["query?", "maxResults?", "label?", "pageToken?"],
  },
  gmail_read: {
    handler: gmailRead,
    description: "Przeczytaj pełną treść emaila",
    params: ["messageId", "markAsRead?"],
  },
  gmail_search: {
    handler: gmailSearch,
    description: "Wyszukaj emaile (Gmail search syntax)",
    params: ["query", "maxResults?"],
  },
  gmail_thread: {
    handler: gmailGetThread,
    description: "Pobierz cały wątek emailowy (konwersację)",
    params: ["threadId", "maxResults?"],
  },

  // ── Gmail — organizacja ──
  gmail_trash: {
    handler: gmailTrash,
    description: "Przenieś email do kosza",
    params: ["messageId"],
  },
  gmail_untrash: {
    handler: gmailUntrash,
    description: "Przywróć email z kosza",
    params: ["messageId"],
  },
  gmail_mark_read: {
    handler: gmailMarkRead,
    description: "Oznacz email jako przeczytany/nieprzeczytany",
    params: ["messageId", "read?"],
  },
  gmail_star: {
    handler: gmailStar,
    description: "Oznacz/odznacz gwiazdkę",
    params: ["messageId", "starred?"],
  },
  gmail_labels: {
    handler: gmailGetLabels,
    description: "Pobierz listę etykiet Gmail",
    params: [],
  },
  gmail_modify_labels: {
    handler: gmailModifyLabels,
    description: "Dodaj/usuń etykiety z emaila",
    params: ["messageId", "addLabels?", "removeLabels?"],
  },
  gmail_batch_modify: {
    handler: gmailBatchModify,
    description: "Zbiorcza operacja na wielu emailach (np. oznacz wszystkie jako przeczytane)",
    params: ["messageIds", "addLabels?", "removeLabels?"],
  },
  gmail_profile: {
    handler: gmailProfile,
    description: "Informacje o koncie Gmail",
    params: [],
  },

  // ── Calendar ──
  calendar_create: {
    handler: calendarCreate,
    description: "Utwórz wydarzenie w kalendarzu",
    params: ["title", "date", "duration?", "description?"],
  },
  calendar_list: {
    handler: calendarList,
    description: "Lista nadchodzących wydarzeń",
    params: ["days?"],
  },

  // ── Notatki ──
  note: {
    handler: createNote,
    description: "Zapisz notatkę",
    params: ["text", "tags?"],
  },
  reminder: {
    handler: createNote,
    description: "Ustaw przypomnienie",
    params: ["text", "date"],
  },
};

/**
 * Wykonuje pojedynczą akcję na podstawie nazwy i parametrów
 */
export async function executeAction({ action, params }) {
  const entry = ACTION_REGISTRY[action];
  if (!entry) {
    throw new Error(`Nieznana akcja: ${action}`);
  }
  return entry.handler(params);
}
