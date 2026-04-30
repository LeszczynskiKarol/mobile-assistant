// Trello REST API — bez SDK, czysty fetch
const API_BASE = 'https://api.trello.com/1';

function trelloFetch(path, opts = {}) {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set('key', process.env.TRELLO_API_KEY);
  url.searchParams.set('token', process.env.TRELLO_TOKEN);

  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, v);
    }
  }

  return fetch(url.toString(), {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(opts.body && { body: JSON.stringify(opts.body) })
  }).then(async (res) => {
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Trello ${res.status}: ${text}`);
    }
    return res.json();
  });
}

/**
 * Utwórz kartę w Trello
 */
export async function trelloCreateCard({ title, description, listId, labels }) {
  const targetList = listId || process.env.TRELLO_DEFAULT_LIST_ID;
  if (!targetList) throw new Error('Brak TRELLO_DEFAULT_LIST_ID w .env');

  const card = await trelloFetch('/cards', {
    method: 'POST',
    params: {
      name: title,
      desc: description || '',
      idList: targetList,
      ...(labels?.length && { idLabels: labels.join(',') })
    }
  });

  return { id: card.id, name: card.name, url: card.shortUrl };
}

/**
 * Przenieś kartę do innej listy (szuka karty po nazwie na domyślnym boardzie)
 */
export async function trelloMoveCard({ cardName, targetList }) {
  const boardId = process.env.TRELLO_DEFAULT_BOARD_ID;
  if (!boardId) throw new Error('Brak TRELLO_DEFAULT_BOARD_ID w .env');

  // Znajdź listę docelową po nazwie
  const lists = await trelloFetch(`/boards/${boardId}/lists`);
  const list = lists.find(l =>
    l.name.toLowerCase().includes(targetList.toLowerCase())
  );
  if (!list) throw new Error(`Lista "${targetList}" nie znaleziona`);

  // Znajdź kartę po nazwie
  const cards = await trelloFetch(`/boards/${boardId}/cards`, {
    params: { fields: 'name,idList' }
  });
  const card = cards.find(c =>
    c.name.toLowerCase().includes(cardName.toLowerCase())
  );
  if (!card) throw new Error(`Karta "${cardName}" nie znaleziona`);

  // Przenieś
  const updated = await trelloFetch(`/cards/${card.id}`, {
    method: 'PUT',
    params: { idList: list.id }
  });

  return { id: updated.id, name: updated.name, movedTo: list.name };
}
