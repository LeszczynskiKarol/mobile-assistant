import {
  trelloCreateCard,
  trelloMoveCard,
  trelloListBoards,
  trelloGetBoard,
  trelloListCards,
  trelloGetCard,
  trelloSearchCards,
  trelloAddComment,
  trelloArchiveCard,
} from "../actions/trello.js";
import {
  gmailSend,
  gmailDraft,
  gmailList,
  gmailRead,
  gmailSearch,
  gmailReply,
  gmailForward,
  gmailTrash,
  gmailUntrash,
  gmailMarkRead,
  gmailStar,
  gmailModifyLabels,
  gmailGetLabels,
  gmailGetThread,
  gmailBatchModify,
  gmailProfile,
} from "../actions/gmail.js";
import { calendarCreate, calendarList } from "../actions/calendar.js";
import { createNote } from "../actions/notes.js";

export const ACTION_REGISTRY = {
  // ── Trello — odczyt ──
  trello_boards: {
    handler: trelloListBoards,
    description: "Lista boardów Trello",
    params: [],
  },
  trello_board: {
    handler: trelloGetBoard,
    description: "Przegląd boardu — wszystkie listy z kartami",
    params: ["boardId?"],
  },
  trello_list_cards: {
    handler: trelloListCards,
    description: "Karty na konkretnej liście",
    params: ["listId?", "listName?"],
  },
  trello_get_card: {
    handler: trelloGetCard,
    description: "Szczegóły karty (opis, checklista, komentarze)",
    params: ["cardId"],
  },
  trello_search: {
    handler: trelloSearchCards,
    description: "Wyszukaj karty po nazwie/tekście",
    params: ["query", "boardId?"],
  },

  // ── Trello — zapis ──
  trello_create_card: {
    handler: trelloCreateCard,
    description: "Utwórz kartę w Trello",
    params: ["title", "description?", "listId?", "labels?", "due?"],
  },
  trello_move_card: {
    handler: trelloMoveCard,
    description: "Przenieś kartę w Trello",
    params: ["cardName?", "cardId?", "targetList"],
  },
  trello_comment: {
    handler: trelloAddComment,
    description: "Dodaj komentarz do karty",
    params: ["cardId?", "cardName?", "text"],
  },
  trello_archive: {
    handler: trelloArchiveCard,
    description: "Archiwizuj kartę",
    params: ["cardId?", "cardName?"],
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
    description: "Odpowiedz na email",
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
    description: "Lista emaili",
    params: ["query?", "maxResults?", "label?", "pageToken?"],
  },
  gmail_read: {
    handler: gmailRead,
    description: "Przeczytaj pełną treść emaila",
    params: ["messageId", "markAsRead?"],
  },
  gmail_search: {
    handler: gmailSearch,
    description: "Wyszukaj emaile",
    params: ["query", "maxResults?"],
  },
  gmail_thread: {
    handler: gmailGetThread,
    description: "Pobierz cały wątek emailowy",
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
    description: "Oznacz jako przeczytany/nieprzeczytany",
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
    description: "Zbiorcza operacja na wielu emailach",
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

export async function executeAction({ action, params }) {
  const entry = ACTION_REGISTRY[action];
  if (!entry) throw new Error(`Nieznana akcja: ${action}`);
  return entry.handler(params);
}
