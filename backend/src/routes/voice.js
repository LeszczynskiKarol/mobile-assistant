import { interpretIntent, generateTopic } from "../services/claude.js";
import { executeAction } from "../services/executor.js";
import prisma from "../services/db.js";

/** @param {import('fastify').FastifyInstance} app */
export async function voiceRoutes(app) {
  // ── POST /api/voice ─────────────────────────────────────────
  // Body: { text: string, conversationId?: string, context?: object }
  // Returns: { response, actions, conversationId, messageId, stats }
  app.post(
    "/voice",
    {
      schema: {
        body: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string", minLength: 1 },
            conversationId: { type: "string" }, // opcjonalny — kontynuacja
            context: { type: "object" },
          },
        },
      },
    },
    async (req, reply) => {
      const { text, conversationId, context } = req.body;

      try {
        // 1. Znajdź lub utwórz konwersację
        let conversation;
        let isNewConversation = false;

        if (conversationId) {
          conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
          });
          if (!conversation) {
            return reply.code(404).send({
              error: "Konwersacja nie znaleziona",
              response: "Nie znalazłem tej konwersacji.",
            });
          }
        }

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: { topic: null },
          });
          isNewConversation = true;
        }

        // 2. Zapisz wiadomość usera do DB
        const userMessage = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "user",
            content: text,
          },
        });

        // 3. Pobierz historię z bazy (nie od klienta — server owns history)
        const dbHistory = await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: "asc" },
          take: 20, // max 20 ostatnich
          select: { role: true, content: true },
        });

        // 4. Claude interpretuje intencję
        const interpretation = await interpretIntent(text, {
          context,
          history: dbHistory.slice(0, -1), // bez aktualnej wiadomości (już jest w text)
        });

        // 5. Wykonaj akcje
        const executedActions = [];
        for (const action of interpretation.actions) {
          try {
            const result = await executeAction(action);
            executedActions.push({ ...action, status: "success", result });
          } catch (err) {
            executedActions.push({
              ...action,
              status: "error",
              error: err.message,
            });
          }
        }

        // 6. Zapisz odpowiedź Claude do DB
        const assistantMessage = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            content: interpretation.response,
            inputTokens: interpretation.inputTokens,
            outputTokens: interpretation.outputTokens,
            totalTokens: interpretation.totalTokens,
            costUsd: interpretation.costUsd,
            model: interpretation.model,
            latencyMs: interpretation.latencyMs,
            actions: executedActions.length > 0 ? executedActions : undefined,
            thinking: interpretation.thinking || null,
            needsInput: interpretation.needsInput || false,
          },
        });

        // 7. Aktualizuj zagregowane statystyki konwersacji
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            totalInputTokens: { increment: interpretation.inputTokens || 0 },
            totalOutputTokens: { increment: interpretation.outputTokens || 0 },
            totalCostUsd: { increment: interpretation.costUsd || 0 },
            messageCount: { increment: 2 }, // user + assistant
            updatedAt: new Date(),
          },
        });

        // 8. Generuj temat jeśli nowa konwersacja
        if (isNewConversation) {
          // Nie blokuj odpowiedzi — generuj temat w tle
          generateTopic(text).then((topic) => {
            prisma.conversation
              .update({
                where: { id: conversation.id },
                data: { topic },
              })
              .catch(() => {});
          });
        }

        // 9. Zwróć odpowiedź
        return {
          response: interpretation.response,
          actions: executedActions,
          thinking: interpretation.thinking,
          needsInput: interpretation.needsInput,
          conversationId: conversation.id,
          messageId: assistantMessage.id,
          isNewConversation,
          stats: {
            inputTokens: interpretation.inputTokens,
            outputTokens: interpretation.outputTokens,
            totalTokens: interpretation.totalTokens,
            costUsd: interpretation.costUsd,
            model: interpretation.model,
            latencyMs: interpretation.latencyMs,
          },
        };
      } catch (err) {
        req.log.error(err);
        return reply.code(500).send({
          response: "Przepraszam, wystąpił błąd. Spróbuj ponownie.",
          actions: [],
          error: err.message,
        });
      }
    },
  );

  // ── GET /api/actions ────────────────────────────────────────
  app.get("/actions", async () => {
    const { ACTION_REGISTRY } = await import("../services/executor.js");
    return Object.entries(ACTION_REGISTRY).map(([key, val]) => ({
      action: key,
      description: val.description,
      params: val.params,
    }));
  });
}
