import { Router, type RequestHandler, type Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { id, pagination } from "../records/validation.js";
import * as schema from "./validation.js";
import { ReportingService } from "./service.js";
function data(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) return value.toFixed(8);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(data);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, data(item)]),
    );
  return value;
}
function send(res: Response, value: unknown) {
  return res.json(data(value));
}
export function reportingRoutes(
  db: PrismaClient,
  auth: RequestHandler,
  admin: RequestHandler,
) {
  const router = Router(),
    staff = Router(),
    service = new ReportingService(db);
  const context = (res: Response) => ({
    actorId: res.locals.user.id as string,
    requestId: res.locals.requestId as string,
  });
  staff.use(auth, admin);
  staff.get("/announcements", async (req, res) => {
    const p = pagination.extend({ companyId: id.optional() }).parse(req.query);
    send(
      res,
      await db.announcement.findMany({
        where: { companyId: p.companyId },
        orderBy: [{ datedAt: "desc" }, { id: "asc" }],
        take: p.limit,
        skip: p.offset,
      }),
    );
  });
  staff.get("/valuations", async (req, res) => {
    const p = pagination.extend({ companyId: id.optional() }).parse(req.query);
    send(
      res,
      await db.valuationSnapshot.findMany({
        where: { shareClass: { companyId: p.companyId } },
        include: { shareClass: { select: { name: true } } },
        orderBy: [{ asOf: "asc" }, { id: "asc" }],
        take: p.limit,
        skip: p.offset,
      }),
    );
  });
  staff.get("/dividend-records", async (req, res) => {
    const p = pagination.extend({ companyId: id.optional() }).parse(req.query);
    send(
      res,
      await db.dividendRecord.findMany({
        where: { shareClass: { companyId: p.companyId } },
        include: { shareClass: { include: { company: true } } },
        orderBy: [{ datedAt: "desc" }, { id: "asc" }],
        take: p.limit,
        skip: p.offset,
      }),
    );
  });
  staff.post("/announcements", async (req, res) => {
    res.status(201);
    send(
      res,
      await service.createAnnouncement(
        context(res),
        schema.announcement.parse(req.body),
      ),
    );
  });
  staff.post("/valuations", async (req, res) => {
    res.status(201);
    send(
      res,
      await service.createValuation(
        context(res),
        schema.valuation.parse(req.body),
      ),
    );
  });
  staff.post("/dividend-records", async (req, res) => {
    res.status(201);
    send(
      res,
      await service.createDividend(
        context(res),
        schema.dividend.parse(req.body),
      ),
    );
  });
  staff.post("/:kind/:id/:action", async (req, res, next) => {
    const kind = schema.kind.safeParse(req.params.kind);
    if (
      !kind.success ||
      !["publish", "withdraw"].includes(String(req.params.action))
    ) {
      next();
      return;
    }
    send(
      res,
      await service.transition(
        context(res),
        kind.data,
        id.parse(req.params.id),
        req.params.action as "publish" | "withdraw",
        schema.action.parse(req.body).reason,
      ),
    );
  });
  router.use("/admin", staff);
  router.get("/companies/:id/announcements", auth, async (req, res) => {
    const p = pagination.parse(req.query);
    send(
      res,
      await service.announcements(
        res.locals.user.id,
        id.parse(req.params.id),
        p.limit,
        p.offset,
      ),
    );
  });
  router.get("/companies/:id/valuations", auth, async (req, res) => {
    const p = pagination.parse(req.query);
    send(
      res,
      await service.valuations(
        res.locals.user.id,
        id.parse(req.params.id),
        p.limit,
        p.offset,
      ),
    );
  });
  router.get("/me/valuation-summary", auth, async (req, res) => {
    const p = pagination
      .pick({})
      .extend({ companyId: id.optional() })
      .parse(req.query);
    send(res, await service.summary(res.locals.user.id, p.companyId));
  });
  router.get("/me/dividend-totals", auth, async (req, res) => {
    const p = pagination
      .pick({})
      .extend({ companyId: id.optional() })
      .parse(req.query);
    send(res, await service.dividendTotals(res.locals.user.id, p.companyId));
  });
  router.get("/me/dividends", auth, async (req, res) => {
    const p = pagination.extend({ companyId: id.optional() }).parse(req.query);
    send(
      res,
      await service.dividends(
        res.locals.user.id,
        p.companyId,
        p.limit,
        p.offset,
      ),
    );
  });
  return router;
}
