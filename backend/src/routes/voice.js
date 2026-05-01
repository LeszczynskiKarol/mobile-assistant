import {
  interpretIntent,
  generateTopic,
  calculateCost,
  summarizeActionResults,
} from "../services/claude.js";
import { needsResearch, runResearch } from "../services/research.js";
import { executeAction } from "../services/executor.js";
import { formatFilesForPrompt } from "../services/fileProcessor.js";
import prisma from "../services/db.js";

const ALLOWED_MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6"];

// Akcje "odczytowe" — wymagają podsumowania wyników przez Claude
const READ_ACTIONS = new Set([
  "contacts_search",
  "calendar_get",
  "calendar_search",
  "calendar_calendars",
  "contacts_list",
  "drive_read",
  "drive_search",
  "drive_recent",
  "drive_file",
  "drive_folder",
  "drive_storage",
  "gmail_list",
  "gmail_read",
  "gmail_search",
  "gmail_thread",
  "gmail_labels",
  "gmail_profile",
  "trello_boards",
  "trello_board",
  "trello_list_cards",
  "trello_get_card",
  "trello_search",
  "trello_activity",
  "trello_create_board", // zwraca listId potrzebne do dodawania kart
  "calendar_list",
]);

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
            stream: { type: "boolean" },
            attachments: { type: "array" },
          },
        },
      },
    },
    async (req, reply) => {
      const { text, conversationId, context, stream, attachments } = req.body;
      const model = req.body.model || "claude-haiku-4-5";
      const startTime = Date.now();

      const fileContext = attachments?.length
        ? formatFilesForPrompt(attachments)
        : "";
      const fullText = text + fileContext;
      const hasFiles = attachments?.length > 0;

      console.log(
        `\n🎤 [VOICE] "${text.slice(0, 100)}" (model: ${model}, stream: ${!!stream}, files: ${attachments?.length || 0})`,
      );

      try {
        let conversation;
        let isNewConversation = false;

        if (conversationId) {
          conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
          });
          if (!conversation)
            return reply
              .code(404)
              .send({ error: "Konwersacja nie znaleziona" });
        }
        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: { topic: null },
          });
          isNewConversation = true;
          console.log(`📝 [VOICE] Nowa konwersacja: ${conversation.id}`);
        }

        const userMessageContent = hasFiles
          ? `${text}\n\n[Załączniki: ${attachments.map((a) => a.filename).join(", ")}]`
          : text;

        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "user",
            content: userMessageContent,
            actions: hasFiles
              ? {
                  attachments: attachments.map((a) => ({
                    filename: a.filename,
                    mimeType: a.mimeType,
                    s3Key: a.s3Key,
                    size: a.size,
                    processingMethod: a.processingMethod,
                  })),
                }
              : undefined,
          },
        });

        const dbHistory = await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: "asc" },
          take: 20,
          select: { role: true, content: true },
        });

        const researchCheck = hasFiles
          ? { needsResearch: false, reason: "files attached" }
          : await needsResearch(text, model);

        // ── STREAMING MODE ──
        if (stream && researchCheck.needsResearch) {
          reply.raw.writeHead(200, {
            "Content-Type": "application/x-ndjson",
            "Transfer-Encoding": "chunked",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          });

          const sendEvent = (type, data) =>
            reply.raw.write(JSON.stringify({ type, ...data }) + "\n");
          sendEvent("status", { message: "🧠 Analizuję zapytanie..." });

          const statusLog = [];
          const onStatus = (msg) => {
            statusLog.push(msg);
            sendEvent("status", { message: msg });
          };

          const researchResult = await runResearch(
            text,
            model,
            dbHistory,
            onStatus,
          );
          const latencyMs = Date.now() - startTime;
          const costUsd = calculateCost(
            model,
            researchResult.inputTokens,
            researchResult.outputTokens,
          );

          const assistantMessage = await prisma.message.create({
            data: {
              conversationId: conversation.id,
              role: "assistant",
              content: researchResult.response,
              inputTokens: researchResult.inputTokens,
              outputTokens: researchResult.outputTokens,
              totalTokens:
                researchResult.inputTokens + researchResult.outputTokens,
              costUsd,
              model,
              latencyMs,
              actions: {
                sources: researchResult.sources,
                researchStatus: statusLog,
              },
              thinking: researchResult.thinking || null,
            },
          });

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              totalInputTokens: { increment: researchResult.inputTokens || 0 },
              totalOutputTokens: {
                increment: researchResult.outputTokens || 0,
              },
              totalCostUsd: { increment: costUsd || 0 },
              messageCount: { increment: 2 },
              updatedAt: new Date(),
            },
          });

          if (isNewConversation) {
            generateTopic(text).then((topic) => {
              prisma.conversation
                .update({ where: { id: conversation.id }, data: { topic } })
                .catch(() => {});
            });
          }

          sendEvent("result", {
            response: researchResult.response,
            actions: [],
            thinking: researchResult.thinking,
            needsInput: false,
            conversationId: conversation.id,
            messageId: assistantMessage.id,
            isNewConversation,
            sources: researchResult.sources,
            researchStatus: statusLog,
            didResearch: true,
            stats: {
              inputTokens: researchResult.inputTokens,
              outputTokens: researchResult.outputTokens,
              totalTokens:
                researchResult.inputTokens + researchResult.outputTokens,
              costUsd,
              model,
              latencyMs,
            },
          });

          reply.raw.end();
          return;
        }

        // ── NON-STREAMING ──
        let finalResponse;
        let sources = [];
        let researchStatus = [];

        if (researchCheck.needsResearch) {
          const statusLog = [];
          const researchResult = await runResearch(
            text,
            model,
            dbHistory,
            (msg) => statusLog.push(msg),
          );
          const latencyMs = Date.now() - startTime;
          const costUsd = calculateCost(
            model,
            researchResult.inputTokens,
            researchResult.outputTokens,
          );

          finalResponse = {
            response: researchResult.response,
            actions: [],
            thinking: researchResult.thinking,
            needsInput: false,
            inputTokens: researchResult.inputTokens,
            outputTokens: researchResult.outputTokens,
            totalTokens:
              researchResult.inputTokens + researchResult.outputTokens,
            costUsd,
            model,
            latencyMs,
          };
          sources = researchResult.sources || [];
          researchStatus = statusLog;
        } else {
          // Normalny flow
          finalResponse = await interpretIntent(fullText, {
            context,
            history: dbHistory.slice(0, -1),
            model,
          });

          const executedActions = [];
          for (const action of finalResponse.actions) {
            console.log(`🔧 [ACTION] ${action.action}`);
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
          finalResponse.actions = executedActions;

          // ── CHAIN: kontynuacja po contacts_email ──
          const contactResult = executedActions.find(
            (a) =>
              a.action === "contacts_email" &&
              a.status === "success" &&
              a.result?.email,
          );
          const alreadySent = executedActions.find(
            (a) => a.action === "gmail_send" && a.status === "success",
          );
          if (contactResult && !alreadySent) {
            console.log(
              `🔗 [CHAIN] Znaleziono email ${contactResult.result.email}, kontynuuję...`,
            );
            const chainResponse = await interpretIntent(
              `Znalazłem email osoby: ${contactResult.result.name} <${contactResult.result.email}>. Kontynuuj wykonanie mojego poprzedniego polecenia: "${text}". Jeśli masz wystarczająco informacji (temat i treść) — wyślij maila. Jeśli user nie podał treści — wymyśl coś odpowiedniego sam.`,
              {
                context: { foundEmail: contactResult.result.email },
                history: dbHistory,
                model,
              },
            );
            // Wykonaj akcje z chain response
            for (const action of chainResponse.actions) {
              console.log(`🔧 [CHAIN ACTION] ${action.action}`);
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
            finalResponse.response = chainResponse.response;
            finalResponse.inputTokens += chainResponse.inputTokens || 0;
            finalResponse.outputTokens += chainResponse.outputTokens || 0;
            finalResponse.totalTokens =
              finalResponse.inputTokens + finalResponse.outputTokens;
            finalResponse.costUsd = calculateCost(
              model,
              finalResponse.inputTokens,
              finalResponse.outputTokens,
            );
            finalResponse.latencyMs = Date.now() - startTime;
            finalResponse.actions = executedActions;
          }

          // ── SECOND PASS: jeśli były akcje odczytowe, podsumuj wyniki ──
          const readResults = executedActions.filter(
            (a) => a.status === "success" && READ_ACTIONS.has(a.action),
          );

          if (readResults.length > 0) {
            console.log(
              `📋 [SECOND-PASS] Podsumowuję ${readResults.length} wynik(ów) akcji odczytowych...`,
            );
            try {
              const summary = await summarizeActionResults(
                text,
                readResults,
                model,
              );
              finalResponse.response = summary.response;
              finalResponse.inputTokens += summary.inputTokens;
              finalResponse.outputTokens += summary.outputTokens;
              finalResponse.totalTokens =
                finalResponse.inputTokens + finalResponse.outputTokens;
              finalResponse.costUsd = calculateCost(
                model,
                finalResponse.inputTokens,
                finalResponse.outputTokens,
              );
              finalResponse.latencyMs = Date.now() - startTime;
              console.log(
                `📋 [SECOND-PASS] Gotowe (+${summary.inputTokens}/${summary.outputTokens} tok)`,
              );
            } catch (err) {
              console.error(`📋 [SECOND-PASS] Błąd: ${err.message}`);
              // Fallback — pokaż surowe wyniki w response
              const fallbackParts = readResults.map((a) => {
                const data = JSON.stringify(a.result, null, 2);
                return `Wynik ${a.action}:\n${data.slice(0, 2000)}`;
              });
              finalResponse.response += "\n\n" + fallbackParts.join("\n\n");
            }
          }
        }

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
            actions:
              finalResponse.actions?.length > 0
                ? finalResponse.actions
                : sources.length > 0
                  ? { sources, researchStatus }
                  : undefined,
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
            prisma.conversation
              .update({ where: { id: conversation.id }, data: { topic } })
              .catch(() => {});
          });
        }

        console.log(
          `✅ [VOICE] Gotowe w ${Date.now() - startTime}ms, $${(finalResponse.costUsd || 0).toFixed(5)}`,
        );

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
        if (reply.raw.writableEnded) return;
        return reply.code(500).send({
          response: "Przepraszam, wystąpił błąd.",
          actions: [],
          error: err.message,
        });
      }
    },
  );

  app.get("/actions", async () => {
    const { ACTION_REGISTRY } = await import("../services/executor.js");
    return Object.entries(ACTION_REGISTRY).map(([key, val]) => ({
      action: key,
      description: val.description,
      params: val.params,
    }));
  });

  app.get("/models", async () => ({
    models: [
      {
        id: "claude-haiku-4-5",
        name: "Haiku 4.5",
        description: "Szybki i tani",
        default: true,
      },
      {
        id: "claude-sonnet-4-6",
        name: "Sonnet 4.6",
        description: "Inteligentniejszy",
        default: false,
      },
    ],
  }));
}
