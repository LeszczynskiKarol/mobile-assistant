import { trelloCreateCard, trelloMoveCard } from '../actions/trello.js';
import { gmailSend, gmailDraft } from '../actions/gmail.js';
import { calendarCreate, calendarList } from '../actions/calendar.js';
import { createNote } from '../actions/notes.js';

// Rejestr akcji — dodawaj nowe tutaj
export const ACTION_REGISTRY = {
  trello_create_card: {
    handler: trelloCreateCard,
    description: 'Utwórz kartę w Trello',
    params: ['title', 'description?', 'listId?', 'labels?']
  },
  trello_move_card: {
    handler: trelloMoveCard,
    description: 'Przenieś kartę w Trello',
    params: ['cardName', 'targetList']
  },
  gmail_send: {
    handler: gmailSend,
    description: 'Wyślij email przez Gmail',
    params: ['to', 'subject', 'body']
  },
  gmail_draft: {
    handler: gmailDraft,
    description: 'Utwórz draft w Gmail',
    params: ['to', 'subject', 'body']
  },
  calendar_create: {
    handler: calendarCreate,
    description: 'Utwórz wydarzenie w kalendarzu',
    params: ['title', 'date', 'duration?', 'description?']
  },
  calendar_list: {
    handler: calendarList,
    description: 'Lista nadchodzących wydarzeń',
    params: ['days?']
  },
  note: {
    handler: createNote,
    description: 'Zapisz notatkę',
    params: ['text', 'tags?']
  },
  reminder: {
    handler: createNote, // na początek reminder = notatka z datą
    description: 'Ustaw przypomnienie',
    params: ['text', 'date']
  },
  web_search: {
    handler: async (params) => ({ info: 'Web search not implemented yet', query: params.query }),
    description: 'Wyszukaj w internecie',
    params: ['query']
  }
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
