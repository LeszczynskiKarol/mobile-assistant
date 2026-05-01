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
 * Utwórz nowy board z listami
 * @param {Object} params
 * @param {string} params.name - nazwa boardu
 * @param {string} [params.description] - opis
 * @param {string[]} [params.lists] - nazwy list do utworzenia (domyślnie: Do zrobienia, W trakcie, Zrobione)
 */
export async function trelloCreateBoard({ name, description, lists }) {
  if (!name) throw new Error("Brakuje name");

  const board = await trelloFetch(
    "/boards",
    {
      name,
      desc: description || "",
      defaultLists: "false", // nie twórz domyślnych list
    },
    { method: "POST" },
  );

  // Twórz listy w odwrotnej kolejności (Trello dodaje na górę)
  const listNames = lists?.length
    ? lists
    : ["Zrobione", "W trakcie", "Do zrobienia"];
  const createdLists = [];
  for (const listName of [...listNames].reverse()) {
    const list = await trelloFetch(
      "/lists",
      {
        name: listName,
        idBoard: board.id,
      },
      { method: "POST" },
    );
    createdLists.unshift({ id: list.id, name: list.name });
  }

  return {
    boardId: board.id,
    name: board.name,
    url: board.url,
    lists: createdLists,
  };
}

/**
 * Utwórz listę na boardzie
 * @param {Object} params
 * @param {string} params.name - nazwa listy
 * @param {string} [params.boardId] - ID boardu (domyślnie default)
 */
export async function trelloCreateList({ name, boardId }) {
  if (!name) throw new Error("Brakuje name");
  const id = boardId || process.env.TRELLO_DEFAULT_BOARD_ID;
  if (!id) throw new Error("Brakuje boardId");

  const list = await trelloFetch(
    "/lists",
    {
      name,
      idBoard: id,
    },
    { method: "POST" },
  );

  return { listId: list.id, name: list.name, boardId: id };
}

/**
 * Utwórz kartę
 */
export async function trelloCreateCard({
  title,
  description,
  listId,
  listName,
  labels,
  due,
  boardId,
  boardName,
}) {
  let bid = boardId;

  // Znajdź board po nazwie
  if (!bid && boardName) {
    const boards = await trelloFetch("/members/me/boards", {
      fields: "name",
      filter: "open",
    });
    const found = boards.find((b) =>
      b.name.toLowerCase().includes(boardName.toLowerCase()),
    );
    if (found) bid = found.id;
    else throw new Error(`Nie znaleziono boardu "${boardName}"`);
  }

  let id = listId;
  if (!id && listName) {
    const searchBid = bid || process.env.TRELLO_DEFAULT_BOARD_ID;
    if (searchBid) {
      const lists = await trelloFetch(`/boards/${searchBid}/lists`, {
        filter: "open",
      });
      const found = lists.find((l) =>
        l.name.toLowerCase().includes(listName.toLowerCase()),
      );
      if (found) id = found.id;
    }
  }

  if (!id) id = process.env.TRELLO_DEFAULT_LIST_ID;
  if (!id) throw new Error("Brakuje listId lub listName");
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
export async function trelloMoveCard({
  cardName,
  cardId,
  boardId,
  boardName,
  targetList,
}) {
  let card;
  if (cardId) {
    card = await trelloFetch(`/cards/${cardId}`, { fields: "name,idBoard" });
  } else if (cardName) {
    const cid = await findCardId(cardName, boardId, boardName);
    card = await trelloFetch(`/cards/${cid}`, { fields: "name,idBoard" });
  } else {
    throw new Error("Brakuje cardName lub cardId");
  }

  // Znajdź docelową listę
  const bid2 = card.idBoard || process.env.TRELLO_DEFAULT_BOARD_ID;
  const lists = await trelloFetch(`/boards/${bid2}/lists`, {
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
export async function trelloAddComment({
  cardId,
  cardName,
  boardId,
  boardName,
  text,
}) {
  if (!text) throw new Error("Brakuje text");
  let id = cardId;
  if (!id && cardName) {
    id = await findCardId(cardName, boardId, boardName);
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
export async function trelloArchiveCard({
  cardId,
  cardName,
  boardId,
  boardName,
}) {
  let id = cardId;
  if (!id && cardName) {
    id = await findCardId(cardName, boardId, boardName);
  }
  if (!id) throw new Error("Brakuje cardId lub cardName");

  await trelloFetch(`/cards/${id}`, { closed: true }, { method: "PUT" });
  return { cardId: id, archived: true };
}

/**
 * Edytuj kartę — zmień nazwę, opis, deadline, etykiety
 */
export async function trelloUpdateCard({
  cardId,
  cardName,
  boardId,
  boardName,
  name,
  description,
  due,
  dueComplete,
  closed,
}) {
  let id = cardId;
  if (!id && cardName) {
    id = await findCardId(cardName, boardId, boardName);
  }
  if (!id) throw new Error("Brakuje cardId lub cardName");

  const params = {};
  if (name !== undefined) params.name = name;
  if (description !== undefined) params.desc = description;
  if (due !== undefined) params.due = due;
  if (dueComplete !== undefined) params.dueComplete = String(dueComplete);
  if (closed !== undefined) params.closed = String(closed);

  if (Object.keys(params).length === 0)
    throw new Error("Brak pól do aktualizacji");

  const card = await trelloFetch(`/cards/${id}`, params, { method: "PUT" });
  return {
    cardId: card.id,
    name: card.name,
    url: card.shortUrl,
    updated: Object.keys(params),
  };
}

/**
 * Usuń kartę na stałe
 */
export async function trelloDeleteCard({
  cardId,
  cardName,
  boardId,
  boardName,
}) {
  let id = cardId;
  if (!id && cardName) {
    id = await findCardId(cardName, boardId, boardName);
  }
  if (!id) throw new Error("Brakuje cardId lub cardName");

  await trelloFetch(`/cards/${id}`, {}, { method: "DELETE" });
  return { cardId: id, deleted: true };
}

/**
 * Utwórz checklistę na karcie
 */
export async function trelloCreateChecklist({
  cardId,
  cardName,
  boardId,
  boardName,
  name,
  items,
}) {
  let id = cardId;
  if (!id && cardName) {
    id = await findCardId(cardName, boardId, boardName);
  }
  if (!id) throw new Error("Brakuje cardId lub cardName");
  if (!name) throw new Error("Brakuje name checklisty");

  const checklist = await trelloFetch(
    `/cards/${id}/checklists`,
    {
      name,
    },
    { method: "POST" },
  );

  // Dodaj elementy jeśli podane
  const createdItems = [];
  if (items?.length) {
    for (const item of items) {
      const ci = await trelloFetch(
        `/checklists/${checklist.id}/checkItems`,
        {
          name: typeof item === "string" ? item : item.name,
        },
        { method: "POST" },
      );
      createdItems.push({ id: ci.id, name: ci.name, state: ci.state });
    }
  }

  return {
    checklistId: checklist.id,
    name: checklist.name,
    cardId: id,
    items: createdItems,
  };
}

/**
 * Oznacz element checklisty jako zrobiony/niezrobiony
 */
export async function trelloToggleCheckItem({
  cardId,
  cardName,
  boardId,
  boardName,
  checkItemId,
  checkItemName,
  state,
}) {
  let id = cardId;
  if (!id && cardName) {
    id = await findCardId(cardName, boardId, boardName);
  }
  if (!id) throw new Error("Brakuje cardId lub cardName");

  // Znajdź checkItem po nazwie jeśli nie podano ID
  let ciId = checkItemId;
  if (!ciId && checkItemName) {
    const checklists = await trelloFetch(`/cards/${id}/checklists`, {
      checkItem_fields: "name,state",
    });
    for (const cl of checklists) {
      const found = cl.checkItems?.find((ci) =>
        ci.name.toLowerCase().includes(checkItemName.toLowerCase()),
      );
      if (found) {
        ciId = found.id;
        break;
      }
    }
    if (!ciId) throw new Error(`Nie znaleziono elementu "${checkItemName}"`);
  }
  if (!ciId) throw new Error("Brakuje checkItemId lub checkItemName");

  // Domyślnie toggle: complete ↔ incomplete
  const newState = state || "complete";

  await trelloFetch(
    `/cards/${id}/checkItem/${ciId}`,
    {
      state: newState,
    },
    { method: "PUT" },
  );

  return { cardId: id, checkItemId: ciId, state: newState };
}

/**
 * Historia aktywności na boardzie (ostatnie akcje)
 */
export async function trelloActivity({ boardId, maxResults = 15 }) {
  const id = boardId || process.env.TRELLO_DEFAULT_BOARD_ID;
  if (!id) throw new Error("Brakuje boardId");

  const actions = await trelloFetch(`/boards/${id}/actions`, {
    filter: "all",
    limit: String(Math.min(50, maxResults)),
    fields: "data,type,date,memberCreator",
    memberCreator_fields: "fullName,username",
  });

  return {
    boardId: id,
    activities: actions.map((a) => ({
      type: a.type,
      date: a.date,
      by: a.memberCreator?.fullName || a.memberCreator?.username || "Nieznany",
      card: a.data?.card?.name,
      list: a.data?.list?.name || a.data?.listAfter?.name,
      listBefore: a.data?.listBefore?.name,
      text: a.data?.text,
      board: a.data?.board?.name,
    })),
    total: actions.length,
  };
}

// Helper — znajdź kartę po nazwie na domyślnym boardzie
async function findCardId(cardName, boardId, boardName) {
  let bid = boardId;
  if (!bid && boardName) {
    const boards = await trelloFetch("/members/me/boards", {
      fields: "name",
      filter: "open",
    });
    const found = boards.find((b) =>
      b.name.toLowerCase().includes(boardName.toLowerCase()),
    );
    if (found) bid = found.id;
    else throw new Error(`Nie znaleziono boardu "${boardName}"`);
  }
  if (!bid) bid = process.env.TRELLO_DEFAULT_BOARD_ID;
  if (!bid) throw new Error("Brakuje boardId do wyszukania karty");
  const cards = await trelloFetch(`/boards/${bid}/cards`, {
    fields: "name",
    filter: "open",
  });
  const found = cards.find((c) =>
    c.name.toLowerCase().includes(cardName.toLowerCase()),
  );
  if (!found) throw new Error(`Nie znaleziono karty "${cardName}"`);
  return found.id;
}

/**
 * Zamknij (archiwizuj) board
 */
export async function trelloCloseBoard({ boardId, boardName }) {
  let id = boardId;
  if (!id && boardName) {
    const boards = await trelloFetch("/members/me/boards", {
      fields: "name",
      filter: "open",
    });
    const found = boards.find((b) =>
      b.name.toLowerCase().includes(boardName.toLowerCase()),
    );
    if (!found) throw new Error(`Nie znaleziono boardu "${boardName}"`);
    id = found.id;
  }
  if (!id) throw new Error("Brakuje boardId lub boardName");

  await trelloFetch(`/boards/${id}`, { closed: true }, { method: "PUT" });
  return { boardId: id, closed: true };
}

/**
 * Usuń board na stałe (NIEODWRACALNE!)
 */
export async function trelloDeleteBoard({ boardId, boardName }) {
  let id = boardId;
  if (!id && boardName) {
    const boards = await trelloFetch("/members/me/boards", {
      fields: "name",
      filter: "all",
    });
    const found = boards.find((b) =>
      b.name.toLowerCase().includes(boardName.toLowerCase()),
    );
    if (!found) throw new Error(`Nie znaleziono boardu "${boardName}"`);
    id = found.id;
  }
  if (!id) throw new Error("Brakuje boardId lub boardName");

  await trelloFetch(`/boards/${id}`, {}, { method: "DELETE" });
  return { boardId: id, deleted: true };
}
