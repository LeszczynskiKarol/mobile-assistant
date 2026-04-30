// backend/src/routes/auth.js

export async function authRoutes(app) {
  app.post("/auth/login", async (req, reply) => {
    const { username, password } = req.body || {};
    const expectedUser = process.env.LOGIN_USER;
    const expectedPass = process.env.LOGIN_PASSWORD;

    if (!expectedUser || !expectedPass)
      return reply
        .status(500)
        .send({ error: "LOGIN_USER/LOGIN_PASSWORD not configured" });

    if (username !== expectedUser || password !== expectedPass)
      return reply.status(401).send({ error: "Invalid credentials" });

    return { token: process.env.VOICE_API_TOKEN };
  });
}
