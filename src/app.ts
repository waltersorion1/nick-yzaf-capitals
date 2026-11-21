import express, {
  type RequestHandler,
  type ErrorRequestHandler,
} from "express";
import session from "express-session";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { PrismaClient, Role } from "@prisma/client";
import { z, ZodError } from "zod";
import { hashPassword, verifyPassword, tokenHash } from "./password.js";
import { importRoutes } from "./imports/routes.js";
import { reportingRoutes } from "./reporting/routes.js";
import { recordRoutes } from "./records/routes.js";
import { RecordError } from "./records/common.js";
import { createLogger, type LogSink } from "./logging.js";
const password = z.string().min(12).max(128);
const email = z
  .string()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
interface Options {
  db: PrismaClient;
  store: session.Store;
  secret: string;
  origin: string;
  production?: boolean;
  logSink?: LogSink;
}
export function createApp({
  db,
  store,
  secret,
  origin,
  production = false,
  logSink,
}: Options) {
  if (secret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  const app = express();
  const log = createLogger(logSink);
  app.disable("x-powered-by");
  app.set("json replacer", (_key: string, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  if (production) app.set("trust proxy", 1);
  app.use(helmet({ strictTransportSecurity: production ? undefined : false }));
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.set("X-Request-ID", res.locals.requestId);
    res.set("Cache-Control", "no-store");
    const start = performance.now();
    const category = req.path.startsWith("/api/auth/")
      ? "auth"
      : req.path.startsWith("/api/admin/")
        ? "admin"
        : req.path.startsWith("/api/")
          ? "shareholder"
          : "public";
    res.on("finish", () =>
      log({
        event: "http_request",
        level: "info",
        requestId: res.locals.requestId,
        category,
        method: [
          "GET",
          "HEAD",
          "POST",
          "PATCH",
          "DELETE",
          "PUT",
          "OPTIONS",
        ].includes(req.method)
          ? req.method
          : "OTHER",
        status: res.statusCode,
        durationMs: Math.round(performance.now() - start),
      }),
    );
    next();
  });
  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1 FROM sessions LIMIT 0`;
      const migrations = await db.$queryRaw<
        Array<{ migration_name: string }>
      >`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      const required = [
        "202611210001_day1",
        "202611210002_day2",
        "202611210003_day4",
        "202611210004_day5",
      ];
      if (
        !required.every((name) =>
          migrations.some((row) => row.migration_name === name),
        )
      )
        throw new Error("Migrations required");
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use((req, res, next) => {
    if (production && !req.secure) {
      res.status(400).json({ error: "HTTPS required" });
      return;
    }
    next();
  });
  app.use("/api/admin/imports/preview", express.json({ limit: "256kb" }));
  app.use(express.json({ limit: "16kb" }));
  app.use(
    session({
      name: "nycap.sid",
      secret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        maxAge: 60 * 60 * 1000,
      },
    }),
  );
  const auth: RequestHandler = async (req, res, next) => {
    const user = req.session.userId
      ? await db.user.findUnique({ where: { id: req.session.userId } })
      : null;
    if (!user?.active || !user.passwordHash) {
      res.status(401).json({ error: "Sign in required" });
      return;
    }
    res.locals.user = user;
    next();
  };
  const admin: RequestHandler = (_req, res, next) => {
    if (res.locals.user.role !== Role.ADMIN) {
      res.status(403).json({ error: "Administrator required" });
      return;
    }
    next();
  };
  app.get("/api/auth/csrf", (req, res) => {
    req.session.csrf ??= randomBytes(32).toString("hex");
    res.json({ token: req.session.csrf });
  });
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      next();
      return;
    }
    const supplied = req.get("X-CSRF-Token") ?? "";
    const expected = req.session.csrf ?? "";
    if (
      (req.get("origin") && req.get("origin") !== origin) ||
      !expected ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      supplied.length !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
      res.status(403).json({ error: "Invalid CSRF token or origin" });
      return;
    }
    next();
  });
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Try again later." },
  });
  app.post("/api/auth/login", limiter, async (req, res) => {
    const input = z
      .object({ email, password: z.string().min(1).max(128) })
      .strict()
      .parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    // Same expensive hash work for unknown accounts to reduce account enumeration.
    const valid = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_HASH,
    );
    if (!user?.active || !valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    await new Promise<void>((ok, fail) =>
      req.session.regenerate((err) => (err ? fail(err) : ok())),
    );
    await db.auditLog.create({ data: { actorId: user.id, action: "LOGIN" } });
    // Do not authenticate a regenerated session unless the login audit succeeded.
    req.session.userId = user.id;
    await new Promise<void>((ok, fail) =>
      req.session.save((err) => (err ? fail(err) : ok())),
    );
    res.json({ id: user.id, email: user.email, role: user.role });
  });
  app.get("/api/auth/me", auth, (_req, res) => {
    const { id, email, role } = res.locals.user;
    res.json({ id, email, role });
  });
  app.post("/api/auth/logout", auth, async (req, res) => {
    await db.auditLog.create({
      data: { actorId: res.locals.user.id, action: "LOGOUT" },
    });
    await new Promise<void>((ok, fail) =>
      req.session.destroy((err) => (err ? fail(err) : ok())),
    );
    res
      .clearCookie("nycap.sid", {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
      })
      .sendStatus(204);
  });
  app.post("/api/admin/users", auth, admin, async (req, res) => {
    const input = z
      .object({
        email,
        role: z.nativeEnum(Role).default(Role.SHAREHOLDER),
        password: password.optional(),
      })
      .strict()
      .parse(req.body);
    const token = input.password ? null : randomBytes(32).toString("hex");
    const encoded = input.password ? await hashPassword(input.password) : null;
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          role: input.role,
          passwordHash: encoded,
          inviteHash: token ? tokenHash(token) : null,
          inviteExpiresAt: token ? new Date(Date.now() + 24 * 3600000) : null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: res.locals.user.id,
          action: token ? "USER_INVITED" : "USER_CREATED",
          targetId: created.id,
        },
      });
      return created;
    });
    // Return invitation once to the admin for private delivery; never log it or store it in plaintext.
    res.status(201).json({
      id: user.id,
      email: user.email,
      role: user.role,
      invitationToken: token,
    });
  });
  app.post("/api/auth/accept-invite", limiter, async (req, res) => {
    const input = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password })
      .strict()
      .parse(req.body);
    const encoded = await hashPassword(input.password);
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { inviteHash: tokenHash(input.token) },
      });
      if (!user?.active) return false;
      const updated = await tx.user.updateMany({
        where: {
          id: user.id,
          inviteHash: tokenHash(input.token),
          inviteExpiresAt: { gt: new Date() },
          active: true,
        },
        data: {
          passwordHash: encoded,
          inviteHash: null,
          inviteExpiresAt: null,
        },
      });
      if (!updated.count) return false;
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "INVITE_ACCEPTED",
          targetId: user.id,
        },
      });
      return true;
    });
    if (!result) {
      res.status(400).json({ error: "Invalid or expired invitation" });
      return;
    }
    res.sendStatus(204);
  });
  app.use("/api", importRoutes(db, auth, admin));
  app.use("/api", reportingRoutes(db, auth, admin));
  app.use("/api", recordRoutes(db, auth, admin));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(
    express.static(resolve("public"), {
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "no-store");
      },
    }),
  );
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof RecordError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err?.code === "P2025") {
      res.status(404).json({ error: "Record not found" });
      return;
    }
    if (
      ["P2003", "P2004", "P2034"].includes(err?.code) ||
      ["23503", "23514", "40001", "40P01"].includes(
        err?.meta?.code ?? err?.meta?.driverAdapterError?.cause?.originalCode,
      )
    ) {
      res.status(409).json({
        error:
          "Record conflicts with register constraints; refresh and check related records",
      });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        error: "Invalid input",
        fields: err.issues.map((i) => i.path.join(".")),
      });
      return;
    }
    if (err?.code === "P2002") {
      res.status(409).json({ error: "Record already exists" });
      return;
    }
    if (err?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    if (err?.type === "entity.too.large") {
      res.status(413).json({ error: "Request too large" });
      return;
    }
    log({
      event: "request_failed",
      level: "error",
      requestId: res.locals.requestId,
    });
    res.status(500).json({ error: "Request failed" });
  };
  app.use(errors);
  return app;
}
const DUMMY_HASH =
  "scrypt-v1:0123456789abcdef0123456789abcdef:" + "00".repeat(64);
