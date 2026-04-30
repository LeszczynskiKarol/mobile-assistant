import { interpretIntent } from '../services/claude.js';
import { executeAction } from '../services/executor.js';

/** @param {import('fastify').FastifyInstance} app */
export async function voiceRoutes(app) {

  // POST /api/voice — główny endpoint
  // Body: { text: string, context?: object }
  // Returns: { response: string, actions: Action[], conversationId?: string }
  app.post('/voice', {
    schema: {
      body: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', minLength: 1 },
          context: { type: 'object' },          // opcjonalny kontekst (np. aktualny ekran)
          history: {                              // historia konwersacji dla multi-turn
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string' },
                content: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const { text, context, history } = req.body;

    try {
      // 1. Claude interpretuje intencję i zwraca JSON z akcjami
      const interpretation = await interpretIntent(text, { context, history });

      // 2. Wykonaj akcje (Trello, Gmail, Calendar, etc.)
      const executedActions = [];
      for (const action of interpretation.actions) {
        try {
          const result = await executeAction(action);
          executedActions.push({ ...action, status: 'success', result });
        } catch (err) {
          executedActions.push({ ...action, status: 'error', error: err.message });
        }
      }

      // 3. Zwróć odpowiedź głosową + log akcji
      return {
        response: interpretation.response,    // tekst do TTS na telefonie
        actions: executedActions,
        thinking: interpretation.thinking      // opcjonalnie — co Claude "pomyślał"
      };

    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({
        response: 'Przepraszam, wystąpił błąd. Spróbuj ponownie.',
        actions: [],
        error: err.message
      });
    }
  });

  // GET /api/actions — lista dostępnych akcji (dla debugowania/UI)
  app.get('/actions', async () => {
    const { ACTION_REGISTRY } = await import('../services/executor.js');
    return Object.entries(ACTION_REGISTRY).map(([key, val]) => ({
      action: key,
      description: val.description,
      params: val.params
    }));
  });
}
