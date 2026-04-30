import { interpretIntent, generateTopic, calculateCost } from "../services/claude.js";
import { needsResearch, runResearch } from "../services/research.js";
import { executeAction } from "../services/executor.js";
import prisma from "../services/db.js";

const ALLOWED_MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6"];

/** @param {import('fastify').FastifyInstance} app */
export async function voiceRoutes(app) {
  app.post(
    "/voice",
    {
      schema: {
        body: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string", minLength: 1 },
            conversationId: { type: "string" },
            model: { type: "string", enum: ALLOWED_MODELS },
            context: { type: "object" },
          },
        },
      },
    },
    async (req, reply) => {
      const { text, conversationId, context } = req.body;
      const model = req.body.model || "claude-haiku-4-5";
      const startTime = Date.now();

      console.log(`\n🎤 [VOICE] "${text.slice(0, 100)}" (model: ${model})`);

      try {
        let conversation;
        let isNewConversation = false;

        if (conversationId) {
          conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
          if (!conversation) {
            return reply.code(404).send({ error: "Konwersacja nie znaleziona" });
          }
        }

        if (!conversation) {
          conversation = await prisma.conversation.create({ data: { topic: null } });
          isNewConversation = true;
          console.log(`📝 [VOICE] Nowa konwersacja: ${conversation.id}`);
        }

        await prisma.message.create({
          data: { conversationId: conversation.id, role: "user", content: text },
        });

        const dbHistory = await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: "asc" },
          take: 20,
          select: { role: true, content: true },
        });

        // Sprawdź research
        const researchCheck = await needsResearch(text, model);

        let finalResponse;
        let sources = [];
        let researchStatus = [];

        if (researchCheck.needsResearch) {
          console.log(`🔬 [VOICE] Research potrzebny — startuję pipeline`);
          const statusLog = [];
          const onStatus = (msg) => statusLog.push(msg);

          const researchResult = await runResearch(text, model, dbHistory, onStatus);
          const latencyMs = Date.now() - startTime;
          const costUsd = calculateCost(model, researchResult.inputTokens, researchResult.outputTokens);

          finalResponse = {
            response: researchResult.response,
            actions: [],
            thinking: researchResult.thinking,
            needsInput: false,
            inputTokens: researchResult.inputTokens,
            outputTokens: researchResult.outputTokens,
            totalTokens: researchResult.inputTokens + researchResult.outputTokens,
            costUsd, model, latencyMs,
          };

          sources = researchResult.sources || [];
          researchStatus = statusLog;

          console.log(`🔬 [VOICE] Research gotowy: ${sources.length} źródeł, $${costUsd.toFixed(5)}, ${latencyMs}ms`);
        } else {
          console.log(`⚡ [VOICE] Bez researchu — normalny flow`);
          finalResponse = await interpretIntent(text, {
            context,
            history: dbHistory.slice(0, -1),
            model,
          });

          const executedActions = [];
          for (const action of finalResponse.actions) {
            console.log(`🔧 [ACTION] Wykonuję: ${action.action}(${JSON.stringify(action.params).slice(0, 100)})`);
            try {
              const result = await executeAction(action);
              executedActions.push({ ...action, status: "success", result });
              console.log(`✅ [ACTION] ${action.action} → OK`);
            } catch (err) {
              executedActions.push({ ...action, status: "error", error: err.message });
              console.error(`❌ [ACTION] ${action.action} → ${err.message}`);
            }
          }
          finalResponse.actions = executedActions;
        }

        // Zapisz do DB
        const assistantMessage = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            content: finalResponse.response,
            inputTokens: finalResponse.inputTokens,
            outputTokens: finalResponse.outputTokens,
            totalTokens: finalResponse.totalTokens,
            costUsd: finalResponse.costUsd,
            model: finalResponse.model,
            latencyMs: finalResponse.latencyMs,
            actions: finalResponse.actions?.length > 0 ? finalResponse.actions : (sources.length > 0 ? { sources, researchStatus } : undefined),
            thinking: finalResponse.thinking || null,
            needsInput: finalResponse.needsInput || false,
          },
        });

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            totalInputTokens: { increment: finalResponse.inputTokens || 0 },
            totalOutputTokens: { increment: finalResponse.outputTokens || 0 },
            totalCostUsd: { increment: finalResponse.costUsd || 0 },
            messageCount: { increment: 2 },
            updatedAt: new Date(),
          },
        });

        if (isNewConversation) {
          generateTopic(text).then((topic) => {
            console.log(`📌 [TOPIC] "${topic}"`);
            prisma.conversation.update({ where: { id: conversation.id }, data: { topic } }).catch(() => {});
          });
        }

        const totalMs = Date.now() - startTime;
        console.log(`✅ [VOICE] Gotowe w ${totalMs}ms, $${(finalResponse.costUsd || 0).toFixed(5)}`);

        return {
          response: finalResponse.response,
          actions: finalResponse.actions || [],
          thinking: finalResponse.thinking,
          needsInput: finalResponse.needsInput,
          conversationId: conversation.id,
          messageId: assistantMessage.id,
          isNewConversation,
          sources,
          researchStatus,
          didResearch: researchCheck.needsResearch,
          stats: {
            inputTokens: finalResponse.inputTokens,
            outputTokens: finalResponse.outputTokens,
            totalTokens: finalResponse.totalTokens,
            costUsd: finalResponse.costUsd,
            model: finalResponse.model,
            latencyMs: finalResponse.latencyMs,
          },
        };
      } catch (err) {
        console.error(`❌ [VOICE] Error: ${err.message}`);
        return reply.code(500).send({
          response: "Przepraszam, wystąpił błąd. Spróbuj ponownie.",
          actions: [],
          error: err.message,
        });
      }
    },
  );

  app.get("/actions", async () => {
    const { ACTION_REGISTRY } = await import("../services/executor.js");
    return Object.entries(ACTION_REGISTRY).map(([key, val]) => ({
      action: key, description: val.description, params: val.params,
    }));
  });

  app.get("/models", async () => ({
    models: [
      { id: "claude-haiku-4-5", name: "Haiku 4.5", description: "Szybki i tani", default: true },
      { id: "claude-sonnet-4-6", name: "Sonnet 4.6", description: "Inteligentniejszy, droższy", default: false },
    ],
  }));
}
