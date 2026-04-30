import prisma from "../services/db.js";

/** @param {import('fastify').FastifyInstance} app */
export async function conversationRoutes(app) {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // GET /api/conversations — lista konwersacji (paginated)
  // Query: ?page=1&limit=20&search=tekst
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.get("/conversations", async (req) => {
    const { page = 1, limit = 20, search } = req.query;
    const take = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (Math.max(1, parseInt(page)) - 1) * take;

    const where = {};

    // Szukaj w temacie konwersacji
    if (search) {
      where.topic = { contains: search, mode: "insensitive" };
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip,
        take,
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1, // ostatnia wiadomość jako podgląd
            select: {
              content: true,
              role: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    return {
      conversations: conversations.map((c) => ({
        id: c.id,
        topic: c.topic || "Nowa konwersacja",
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messageCount,
        totalInputTokens: c.totalInputTokens,
        totalOutputTokens: c.totalOutputTokens,
        totalCostUsd: c.totalCostUsd,
        lastMessage: c.messages[0] || null,
      })),
      pagination: {
        page: parseInt(page),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    };
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // GET /api/conversations/:id — konwersacja ze wszystkimi wiadomościami
  // Query: ?search=tekst (filtrowanie wiadomości w tej konwersacji)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.get("/conversations/:id", async (req, reply) => {
    const { id } = req.params;
    const { search } = req.query;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      return reply.code(404).send({ error: "Konwersacja nie znaleziona" });
    }

    // Pobierz wiadomości — opcjonalnie z filtrem
    const messageWhere = { conversationId: id };
    if (search) {
      messageWhere.content = { contains: search, mode: "insensitive" };
    }

    const messages = await prisma.message.findMany({
      where: messageWhere,
      orderBy: { createdAt: "asc" },
    });

    return {
      id: conversation.id,
      topic: conversation.topic || "Nowa konwersacja",
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      stats: {
        messageCount: conversation.messageCount,
        totalInputTokens: conversation.totalInputTokens,
        totalOutputTokens: conversation.totalOutputTokens,
        totalTokens:
          conversation.totalInputTokens + conversation.totalOutputTokens,
        totalCostUsd: conversation.totalCostUsd,
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        totalTokens: m.totalTokens,
        costUsd: m.costUsd,
        model: m.model,
        latencyMs: m.latencyMs,
        actions: m.actions,
        thinking: m.thinking,
        needsInput: m.needsInput,
        createdAt: m.createdAt,
      })),
      searchQuery: search || null,
    };
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUT /api/conversations/:id — edycja tematu konwersacji
  // Body: { topic: string }
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.put("/conversations/:id", async (req, reply) => {
    const { id } = req.params;
    const { topic } = req.body;

    if (!topic || typeof topic !== "string") {
      return reply.code(400).send({ error: "Brak pola topic" });
    }

    try {
      const updated = await prisma.conversation.update({
        where: { id },
        data: { topic: topic.trim() },
      });
      return { id: updated.id, topic: updated.topic };
    } catch {
      return reply.code(404).send({ error: "Konwersacja nie znaleziona" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DELETE /api/conversations/:id — usuń konwersację i wiadomości
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.delete("/conversations/:id", async (req, reply) => {
    const { id } = req.params;
    try {
      await prisma.conversation.delete({ where: { id } });
      return { deleted: true };
    } catch {
      return reply.code(404).send({ error: "Konwersacja nie znaleziona" });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // GET /api/search — globalne wyszukiwanie we WSZYSTKICH konwersacjach
  // Query: ?q=szukany+tekst&page=1&limit=20
  // Szuka w treści wiadomości (user + assistant) + tematach konwersacji
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.get("/search", async (req, reply) => {
    const { q, page = 1, limit = 20 } = req.query;

    if (!q || q.trim().length < 2) {
      return reply
        .code(400)
        .send({ error: "Parametr q musi mieć min. 2 znaki" });
    }

    const take = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (Math.max(1, parseInt(page)) - 1) * take;
    const searchTerm = q.trim();

    // Szukaj w wiadomościach
    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: {
          content: { contains: searchTerm, mode: "insensitive" },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          conversation: {
            select: {
              id: true,
              topic: true,
            },
          },
        },
      }),
      prisma.message.count({
        where: {
          content: { contains: searchTerm, mode: "insensitive" },
        },
      }),
    ]);

    // Osobno: szukaj w tematach konwersacji
    const matchingConversations = await prisma.conversation.findMany({
      where: {
        topic: { contains: searchTerm, mode: "insensitive" },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        topic: true,
        messageCount: true,
        updatedAt: true,
      },
    });

    return {
      query: searchTerm,
      messageResults: {
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          conversationId: m.conversation.id,
          conversationTopic: m.conversation.topic || "Nowa konwersacja",
          // Fragment z podświetleniem — zwracamy pozycję dopasowania
          matchContext: extractContext(m.content, searchTerm),
        })),
        pagination: {
          page: parseInt(page),
          limit: take,
          total,
          totalPages: Math.ceil(total / take),
        },
      },
      conversationResults: matchingConversations,
    };
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // GET /api/stats — globalne statystyki
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  app.get("/stats", async () => {
    const [convCount, msgCount, tokenAgg, costAgg, todayMessages] =
      await Promise.all([
        prisma.conversation.count(),
        prisma.message.count(),
        prisma.message.aggregate({
          _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
        }),
        prisma.message.aggregate({
          _sum: { costUsd: true },
        }),
        prisma.message.count({
          where: {
            createdAt: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
            },
          },
        }),
      ]);

    return {
      totalConversations: convCount,
      totalMessages: msgCount,
      todayMessages,
      tokens: {
        totalInput: tokenAgg._sum.inputTokens || 0,
        totalOutput: tokenAgg._sum.outputTokens || 0,
        total: tokenAgg._sum.totalTokens || 0,
      },
      totalCostUsd: costAgg._sum.costUsd || 0,
      totalCostPln: ((costAgg._sum.costUsd || 0) * 4.05).toFixed(2),
    };
  });
}

/**
 * Wyciąga fragment tekstu wokół dopasowania (±80 znaków)
 */
function extractContext(content, searchTerm) {
  const lowerContent = content.toLowerCase();
  const lowerTerm = searchTerm.toLowerCase();
  const idx = lowerContent.indexOf(lowerTerm);
  if (idx === -1) return content.slice(0, 160);

  const start = Math.max(0, idx - 80);
  const end = Math.min(content.length, idx + searchTerm.length + 80);
  let fragment = "";
  if (start > 0) fragment += "...";
  fragment += content.slice(start, end);
  if (end < content.length) fragment += "...";

  return fragment;
}
