// Trello REST API
const TRELLO_API = "https://api.trello.com/1";

function trelloUrl(path, params = {}) {
  const url = new URL(`${TRELLO_API}${path}`);
  url.searchParams.set("key", process.env.TRELLO_API_KEY);
  url.searchParams.set("token", process.env.TRELLO_TOKEN);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function trelloFetch(path, params = {}, opts = {}) {
  const url = trelloUrl(path, params);
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    ...(opts.body && { body: JSON.stringify(opts.body) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trello ${res.status}: ${text}`);
  }
  if (res.status === 204) return { success: true };
  return res.json();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function parseCard(c) {
  return {
    id: c.id,
    name: c.name,
    description: c.desc || undefined,
    url: c.shortUrl || c.url,
    listId: c.idList,
    listName: c.list?.name,
    boardId: c.idBoard,
    labels: c.labels?.map((l) => ({ name: l.name, color: l.color })) || [],
    due: c.due || undefined,
    dueComplete: c.dueComplete || false,
    closed: c.closed || false,
    members: c.members?.map((m) => m.fullName || m.username) || [],
    checklists:
      c.checklists?.map((cl) => ({
        name: cl.name,
        items:
          cl.checkItems?.map((i) => ({
            name: i.name,
            state: i.state, // 'complete' | 'incomplete'
          })) || [],
      })) || [],
    commentsCount: c.badges?.comments || 0,
    attachmentsCount: c.badges?.attachments || 0,
    dateLastActivity: c.dateLastActivity,
  };
}

function parseList(l) {
  return {
    id: l.id,
    name: l.name,
    closed: l.closed || false,
    pos: l.pos,
    cardCount: l.cards?.length,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ODCZYT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Lista boardów użytkownika
 */
export async function trelloListBoards() {
  const boards = await trelloFetch("/members/me/boards", {
    fields: "name,url,dateLastActivity,closed,desc",
    filter: "open",
  });
  return {
    boards: boards.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.desc || undefined,
      url: b.url,
      lastActivity: b.dateLastActivity,
    })),
  };
}

/**
 * Przegląd boardu — listy z kartami
 * @param {Object} params
 * @param {string} [params.boardId] - ID boardu (domyślnie TRELLO_DEFAULT_BOARD_ID)
 */
export async function trelloGetBoard({ boardId } = {}) {
  const id = boardId || process.env.TRELLO_DEFAULT_BOARD_ID;
  if (!id) throw new Error("Brakuje boardId");

  const [board, lists, cards] = await Promise.all([
    trelloFetch(`/boards/${id}`, { fields: "name,url,desc,dateLastActivity" }),
    trelloFetch(`/boards/${id}/lists`, {
      filter: "open",
      fields: "name,pos,closed",
    }),
    trelloFetch(`/boards/${id}/cards`, {
      fields:
        "name,desc,idList,shortUrl,labels,due,dueComplete,closed,dateLastActivity,badges",
      filter: "open",
      members: "true",
      member_fields: "fullName,username",
    }),
  ]);

  // Grupuj karty po listach
  const cardsByList = {};
  for (const c of cards) {
    if (!cardsByList[c.idList]) cardsByList[c.idList] = [];
    cardsByList[c.idList].push(parseCard(c));
  }

  return {
    board: {
      id: board.id,
      name: board.name,
      description: board.desc || undefined,
      url: board.url,
      lastActivity: board.dateLastActivity,
    },
    lists: lists.map((l) => ({
      ...parseList(l),
      cards: cardsByList[l.id] || [],
    })),
    totalCards: cards.length,
  };
}

/**
 * Lista kart na konkretnej liście
 * @param {Object} params
 * @param {string} [params.listId] - ID listy (domyślnie TRELLO_DEFAULT_LIST_ID)
 * @param {string} [params.listName] - Nazwa listy (alternatywa do listId — szuka na default board)
 */
export async function trelloListCards({ listId, listName } = {}) {
  let id = listId || process.env.TRELLO_DEFAULT_LIST_ID;

  // Jeśli podano nazwę listy zamiast ID — znajdź po nazwie
  if (!id && listName) {
    const boardId = process.env.TRELLO_DEFAULT_BOARD_ID;
    if (!boardId)
      throw new Error("Brakuje boardId do wyszukania listy po nazwie");
    const lists = await trelloFetch(`/boards/${boardId}/lists`, {
      filter: "open",
    });
    const found = lists.find((l) =>
      l.name.toLowerCase().includes(listName.toLowerCase()),
    );
    if (!found) throw new Error(`Nie znaleziono listy "${listName}"`);
    id = found.id;
  }

  if (!id) throw new Error("Brakuje listId lub listName");

  const [list, cards] = await Promise.all([
    trelloFetch(`/lists/${id}`, { fields: "name,closed" }),
    trelloFetch(`/lists/${id}/cards`, {
      fields:
        "name,desc,shortUrl,labels,due,dueComplete,closed,dateLastActivity,badges",
      members: "true",
      member_fields: "fullName,username",
    }),
  ]);

  return {
    list: { id: list.id, name: list.name },
    cards: cards.map(parseCard),
    totalCards: cards.length,
  };
}

/**
 * Szczegóły pojedynczej karty
 * @param {Object} params
 * @param {string} params.cardId - ID karty
 */
export async function trelloGetCard({ cardId }) {
  if (!cardId) throw new Error("Brakuje cardId");

  const card = await trelloFetch(`/cards/${cardId}`, {
    fields:
      "name,desc,idList,idBoard,shortUrl,labels,due,dueComplete,closed,dateLastActivity,badges",
    members: "true",
    member_fields: "fullName,username",
    checklists: "all",
    checklist_fields: "name",
    list: "true",
    list_fields: "name",
  });

  // Pobierz komentarze
  const comments = await trelloFetch(`/cards/${cardId}/actions`, {
    filter: "commentCard",
    fields: "data,date,memberCreator",
    memberCreator_fields: "fullName",
  });

  const parsed = parseCard(card);
  parsed.comments = comments.slice(0, 10).map((c) => ({
    author: c.memberCreator?.fullName || "Nieznany",
    text: c.data?.text || "",
    date: c.date,
  }));

  return parsed;
}

/**
 * Wyszukaj karty na boardzie po nazwie/tekście
 * @param {Object} params
 * @param {string} params.query - tekst do wyszukania
 * @param {string} [params.boardId] - ID boardu (domyślnie default)
 */
export async function trelloSearchCards({ query, boardId }) {
  if (!query) throw new Error("Brakuje query");
  const id = boardId || process.env.TRELLO_DEFAULT_BOARD_ID;

  const result = await trelloFetch("/search", {
    query,
    idBoards: id || undefined,
    modelTypes: "cards",
    cards_limit: 20,
    card_fields:
      "name,desc,idList,shortUrl,labels,due,dueComplete,closed,dateLastActivity,badges",
    card_members: "true",
    card_member_fields: "fullName,username",
    card_list: "true",
  });

  return {
    query,
    cards: (result.cards || []).map((c) => {
      const parsed = parseCard(c);
      parsed.listName = c.list?.name;
      return parsed;
    }),
    totalFound: result.cards?.length || 0,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ZAPIS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Utwórz kartę
 */
export async function trelloCreateCard({
  title,
  description,
  listId,
  labels,
  due,
}) {
  const id = listId || process.env.TRELLO_DEFAULT_LIST_ID;
  if (!id) throw new Error("Brakuje listId");
  if (!title) throw new Error("Brakuje title");

  const params = { name: title, idList: id };
  if (description) params.desc = description;
  if (due) params.due = due;

  const card = await trelloFetch("/cards", params, { method: "POST" });

  // Dodaj etykiety jeśli podane
  if (labels?.length) {
    const boardId = card.idBoard;
    const boardLabels = await trelloFetch(`/boards/${boardId}/labels`);
    for (const labelName of labels) {
      const found = boardLabels.find(
        (l) =>
          l.name.toLowerCase() === labelName.toLowerCase() ||
          l.color?.toLowerCase() === labelName.toLowerCase(),
      );
      if (found) {
        await trelloFetch(
          `/cards/${card.id}/idLabels`,
          { value: found.id },
          { method: "POST" },
        );
      }
    }
  }

  return { cardId: card.id, name: card.name, url: card.shortUrl, listId: id };
}

/**
 * Przenieś kartę (po nazwie lub ID)
 */
export async function trelloMoveCard({ cardName, cardId, targetList }) {
  // Znajdź kartę
  let card;
  if (cardId) {
    card = await trelloFetch(`/cards/${cardId}`, { fields: "name,idBoard" });
  } else if (cardName) {
    const boardId = process.env.TRELLO_DEFAULT_BOARD_ID;
    const cards = await trelloFetch(`/boards/${boardId}/cards`, {
      fields: "name",
      filter: "open",
    });
    card = cards.find((c) =>
      c.name.toLowerCase().includes(cardName.toLowerCase()),
    );
    if (!card) throw new Error(`Nie znaleziono karty "${cardName}"`);
  } else {
    throw new Error("Brakuje cardName lub cardId");
  }

  // Znajdź docelową listę
  const boardId = card.idBoard || process.env.TRELLO_DEFAULT_BOARD_ID;
  const lists = await trelloFetch(`/boards/${boardId}/lists`, {
    filter: "open",
  });
  const target = lists.find((l) =>
    l.name.toLowerCase().includes(targetList.toLowerCase()),
  );
  if (!target) throw new Error(`Nie znaleziono listy "${targetList}"`);

  await trelloFetch(
    `/cards/${card.id}`,
    { idList: target.id },
    { method: "PUT" },
  );
  return { cardId: card.id, cardName: card.name, movedTo: target.name };
}

/**
 * Dodaj komentarz do karty
 */
export async function trelloAddComment({ cardId, cardName, text }) {
  if (!text) throw new Error("Brakuje text");

  let id = cardId;
  if (!id && cardName) {
    const boardId = process.env.TRELLO_DEFAULT_BOARD_ID;
    const cards = await trelloFetch(`/boards/${boardId}/cards`, {
      fields: "name",
      filter: "open",
    });
    const found = cards.find((c) =>
      c.name.toLowerCase().includes(cardName.toLowerCase()),
    );
    if (!found) throw new Error(`Nie znaleziono karty "${cardName}"`);
    id = found.id;
  }
  if (!id) throw new Error("Brakuje cardId lub cardName");

  const result = await trelloFetch(
    `/cards/${id}/actions/comments`,
    { text },
    { method: "POST" },
  );
  return { cardId: id, commentId: result.id, text };
}

/**
 * Archiwizuj kartę
 */
export async function trelloArchiveCard({ cardId, cardName }) {
  let id = cardId;
  if (!id && cardName) {
    const boardId = process.env.TRELLO_DEFAULT_BOARD_ID;
    const cards = await trelloFetch(`/boards/${boardId}/cards`, {
      fields: "name",
      filter: "open",
    });
    const found = cards.find((c) =>
      c.name.toLowerCase().includes(cardName.toLowerCase()),
    );
    if (!found) throw new Error(`Nie znaleziono karty "${cardName}"`);
    id = found.id;
  }
  if (!id) throw new Error("Brakuje cardId lub cardName");

  await trelloFetch(`/cards/${id}`, { closed: true }, { method: "PUT" });
  return { cardId: id, archived: true };
}
