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
  trelloCreateBoard,
  trelloCreateList,
  trelloUpdateCard,
  trelloDeleteCard,
  trelloCreateChecklist,
  trelloToggleCheckItem,
  trelloActivity,
  trelloCloseBoard,
  trelloDeleteBoard,
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
  gmailSendAttachment,
} from "../actions/gmail.js";
import {
  calendarCreate,
  calendarList,
  calendarGet,
  calendarUpdate,
  calendarDelete,
  calendarSearch,
  calendarQuickAdd,
  calendarCalendars,
  calendarMove,
  calendarAttach,
  calendarCreateCalendar,
  calendarDeleteCalendar,
} from "../actions/calendar.js";
import {
  contactsSearch,
  contactsList,
  contactsGetEmail,
  contactsFromGmail,
} from "../actions/contacts.js";
import {
  driveSearch,
  driveRecent,
  driveGetFile,
  driveListFolder,
  driveStorage,
  driveReadContent,
  driveShare,
  driveExport,
  driveTrash,
  driveUntrash,
  driveDelete,
  driveBatchTrash,
  driveEmptyTrash,
  driveUpdate,
  driveMove,
  driveCreateFolder,
} from "../actions/drive.js";

import { createNote } from "../actions/notes.js";

export const ACTION_REGISTRY = {
  // ── Kontakty ──
  gmail_send_attachment: {
    handler: gmailSendAttachment,
    description: "Wyślij email z załącznikiem z Google Drive",
    params: ["to", "subject", "body?", "driveFileId", "cc?"],
  },

  contacts_gmail: {
    handler: contactsFromGmail,
    description: "Szukaj emaila w historii maili Gmail",
    params: ["name", "maxResults?"],
  },
  contacts_search: {
    handler: contactsSearch,
    description: "Wyszukaj kontakty po nazwie lub emailu",
    params: ["query", "maxResults?"],
  },
  contacts_list: {
    handler: contactsList,
    description: "Lista ostatnio modyfikowanych kontaktów",
    params: ["maxResults?"],
  },
  contacts_email: {
    handler: contactsGetEmail,
    description: "Znajdź email kontaktu po nazwie (helper do wysyłki)",
    params: ["name"],
  },

  // ── Google Drive ──
  drive_trash: {
    handler: driveTrash,
    description: "Przenieś plik do kosza (odwracalne)",
    params: ["fileId"],
  },
  drive_untrash: {
    handler: driveUntrash,
    description: "Przywróć plik z kosza",
    params: ["fileId"],
  },
  drive_delete: {
    handler: driveDelete,
    description: "Usuń plik na stałe (NIEODWRACALNE!)",
    params: ["fileId"],
  },
  drive_batch_trash: {
    handler: driveBatchTrash,
    description: "Masowe przeniesienie do kosza (max 50)",
    params: ["fileIds"],
  },
  drive_empty_trash: {
    handler: driveEmptyTrash,
    description: "Opróżnij kosz Drive",
    params: [],
  },
  drive_update: {
    handler: driveUpdate,
    description: "Edytuj nazwę/opis/gwiazdkę pliku",
    params: ["fileId", "name?", "description?", "starred?"],
  },
  drive_move: {
    handler: driveMove,
    description: "Przenieś plik do folderu",
    params: ["fileId", "folderId?", "folderName?"],
  },
  drive_create_folder: {
    handler: driveCreateFolder,
    description: "Utwórz folder",
    params: ["name", "parentId?"],
  },
  drive_share: {
    handler: driveShare,
    description: "Udostępnij plik",
    params: ["fileId", "email", "role?", "notify?"],
  },
  drive_export: {
    handler: driveExport,
    description: "Eksportuj Google Doc jako PDF",
    params: ["fileId", "mimeType?"],
  },

  drive_search: {
    handler: driveSearch,
    description: "Wyszukaj pliki na Google Drive",
    params: ["query", "maxResults?", "type?"],
  },
  drive_recent: {
    handler: driveRecent,
    description: "Ostatnio modyfikowane pliki",
    params: ["maxResults?", "type?"],
  },
  drive_file: {
    handler: driveGetFile,
    description: "Szczegóły pliku",
    params: ["fileId"],
  },
  drive_folder: {
    handler: driveListFolder,
    description: "Lista plików w folderze",
    params: ["folderId?", "folderName?", "maxResults?"],
  },
  drive_storage: {
    handler: driveStorage,
    description: "Info o pojemności Drive",
    params: [],
  },
  drive_read: {
    handler: driveReadContent,
    description:
      "Pobierz i przeczytaj zawartość pliku z Drive (Google Docs, PDF, obrazy)",
    params: ["fileId", "maxChars?"],
  },

  // ── Trello — odczyt ──
  trello_close_board: {
    handler: trelloCloseBoard,
    description: "Zamknij/archiwizuj board (odwracalne)",
    params: ["boardId?", "boardName?"],
  },
  trello_delete_board: {
    handler: trelloDeleteBoard,
    description: "Usuń board na stałe (NIEODWRACALNE!)",
    params: ["boardId?", "boardName?"],
  },

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
  trello_create_board: {
    handler: trelloCreateBoard,
    description: "Utwórz nowy board z listami",
    params: ["name", "description?", "lists?"],
  },
  trello_create_list: {
    handler: trelloCreateList,
    description: "Utwórz nową listę na boardzie",
    params: ["name", "boardId?"],
  },
  trello_create_card: {
    handler: trelloCreateCard,
    description: "Utwórz kartę w Trello",
    params: [
      "title",
      "description?",
      "listId?",
      "listName?",
      "boardId?",
      "boardName?",
      "labels?",
      "due?",
    ],
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
  trello_update_card: {
    handler: trelloUpdateCard,
    description: "Edytuj kartę (zmień nazwę, opis, deadline, zamknij/otwórz)",
    params: [
      "cardId?",
      "cardName?",
      "name?",
      "description?",
      "due?",
      "dueComplete?",
      "closed?",
    ],
  },
  trello_delete: {
    handler: trelloDeleteCard,
    description: "Usuń kartę na stałe (nieodwracalne!)",
    params: ["cardId?", "cardName?"],
  },
  trello_checklist: {
    handler: trelloCreateChecklist,
    description: "Utwórz checklistę na karcie z elementami",
    params: ["cardId?", "cardName?", "name", "items?"],
  },
  trello_toggle_check: {
    handler: trelloToggleCheckItem,
    description: "Oznacz element checklisty jako zrobiony/niezrobiony",
    params: [
      "cardId?",
      "cardName?",
      "checkItemId?",
      "checkItemName?",
      "state?",
    ],
  },
  trello_activity: {
    handler: trelloActivity,
    description: "Historia aktywności na boardzie (co się ostatnio działo)",
    params: ["boardId?", "maxResults?"],
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
  calendar_create_calendar: {
    handler: calendarCreateCalendar,
    description: "Utwórz nowy kalendarz",
    params: ["name", "description?", "timeZone?"],
  },
  calendar_delete_calendar: {
    handler: calendarDeleteCalendar,
    description: "Usuń kalendarz (nie primary!)",
    params: ["calendarId"],
  },

  calendar_create: {
    handler: calendarCreate,
    description: "Utwórz wydarzenie w kalendarzu",
    params: [
      "title",
      "date",
      "endDate?",
      "duration?",
      "description?",
      "location?",
      "attendees?",
      "recurrence?",
      "allDay?",
      "reminders?",
      "attachments?",
    ],
  },
  calendar_list: {
    handler: calendarList,
    description: "Lista nadchodzących wydarzeń",
    params: ["days?", "maxResults?", "query?"],
  },
  calendar_get: {
    handler: calendarGet,
    description: "Szczegóły wydarzenia",
    params: ["eventId"],
  },
  calendar_update: {
    handler: calendarUpdate,
    description:
      "Edytuj wydarzenie (zmień czas, tytuł, opis, lokalizację, uczestników)",
    params: [
      "eventId",
      "title?",
      "date?",
      "endDate?",
      "duration?",
      "description?",
      "location?",
      "attendees?",
    ],
  },
  calendar_delete: {
    handler: calendarDelete,
    description: "Usuń wydarzenie",
    params: ["eventId", "notifyAttendees?"],
  },
  calendar_search: {
    handler: calendarSearch,
    description: "Wyszukaj wydarzenia po tekście",
    params: ["query", "days?", "maxResults?"],
  },
  calendar_quick_add: {
    handler: calendarQuickAdd,
    description: "Szybkie tworzenie wydarzenia naturalnym językiem",
    params: ["text"],
  },
  calendar_calendars: {
    handler: calendarCalendars,
    description: "Lista kalendarzy użytkownika",
    params: ["maxResults?"],
  },
  calendar_move: {
    handler: calendarMove,
    description: "Przenieś wydarzenie do innego kalendarza",
    params: ["eventId", "destinationCalendarId"],
  },
  calendar_attach: {
    handler: calendarAttach,
    description: "Dodaj załącznik z Drive do wydarzenia",
    params: ["eventId", "driveFileId"],
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
