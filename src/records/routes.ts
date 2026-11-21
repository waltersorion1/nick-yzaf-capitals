import { Router, type RequestHandler, type Response } from "express";
import { PrismaClient } from "@prisma/client";
import { RecordService } from "./service.js";
import { ownershipPercentage } from "./common.js";
import * as schema from "./validation.js";
export function recordRoutes(
  db: PrismaClient,
  auth: RequestHandler,
  admin: RequestHandler,
) {
  const router = Router();
  const service = new RecordService(db);
  const context = (res: Response) => ({
    actorId: res.locals.user.id,
    requestId: res.locals.requestId,
  });

  const adminRouter = Router();
  adminRouter.use(auth, admin);
  adminRouter.get("/companies", async (req, res) => {
    const p = schema.pagination.parse(req.query);
    res.json(
      await db.company.findMany({
        take: p.limit,
        skip: p.offset,
        orderBy: { id: "asc" },
      }),
    );
  });
  adminRouter.get("/companies/:id", async (req, res) => {
    res.json(
      await db.company.findUniqueOrThrow({
        where: { id: schema.id.parse(req.params.id) },
      }),
    );
  });
  adminRouter.post("/companies", async (req, res) => {
    res
      .status(201)
      .json(
        await service.saveCompany(
          context(res),
          null,
          schema.companyCreate.parse(req.body),
        ),
      );
  });
  adminRouter.patch("/companies/:id", async (req, res) => {
    res.json(
      await service.saveCompany(
        context(res),
        schema.id.parse(req.params.id),
        schema.companyUpdate.parse(req.body),
      ),
    );
  });
  adminRouter.delete("/companies/:id", async (req, res) => {
    await service.deleteCompany(
      context(res),
      schema.id.parse(req.params.id),
      schema.deletion.parse(req.body).reason,
    );
    res.sendStatus(204);
  });
  adminRouter.get("/share-classes", async (req, res) => {
    const p = schema.pagination
      .extend({ companyId: schema.id.optional() })
      .parse(req.query);
    res.json(
      await db.shareClass.findMany({
        where: { companyId: p.companyId },
        take: p.limit,
        skip: p.offset,
        orderBy: { id: "asc" },
      }),
    );
  });
  adminRouter.get("/share-classes/:id/reconciliation", async (req, res) => {
    res.json(await service.reconcile(schema.id.parse(req.params.id)));
  });
  adminRouter.get("/share-classes/:id", async (req, res) => {
    res.json(
      await db.shareClass.findUniqueOrThrow({
        where: { id: schema.id.parse(req.params.id) },
      }),
    );
  });
  adminRouter.post("/share-classes", async (req, res) => {
    res
      .status(201)
      .json(
        await service.createClass(
          context(res),
          schema.classCreate.parse(req.body),
        ),
      );
  });
  adminRouter.patch("/share-classes/:id", async (req, res) => {
    res.json(
      await service.updateClass(
        context(res),
        schema.id.parse(req.params.id),
        schema.classUpdate.parse(req.body),
      ),
    );
  });
  adminRouter.delete("/share-classes/:id", async (req, res) => {
    await service.deleteClass(
      context(res),
      schema.id.parse(req.params.id),
      schema.deletion.parse(req.body).reason,
    );
    res.sendStatus(204);
  });
  adminRouter.get("/shareholders", async (req, res) => {
    const p = schema.pagination.parse(req.query);
    res.json(
      await db.shareholder.findMany({
        take: p.limit,
        skip: p.offset,
        orderBy: { id: "asc" },
      }),
    );
  });
  adminRouter.get("/shareholders/:id", async (req, res) => {
    res.json(
      await db.shareholder.findUniqueOrThrow({
        where: { id: schema.id.parse(req.params.id) },
      }),
    );
  });
  adminRouter.post("/shareholders", async (req, res) => {
    res
      .status(201)
      .json(
        await service.createProfile(
          context(res),
          schema.profileCreate.parse(req.body),
        ),
      );
  });
  adminRouter.patch("/shareholders/:id", async (req, res) => {
    res.json(
      await service.updateProfile(
        context(res),
        schema.id.parse(req.params.id),
        schema.profileUpdate.parse(req.body),
      ),
    );
  });
  adminRouter.delete("/shareholders/:id", async (req, res) => {
    await service.deleteProfile(
      context(res),
      schema.id.parse(req.params.id),
      schema.deletion.parse(req.body).reason,
    );
    res.sendStatus(204);
  });
  adminRouter.get("/holdings", async (req, res) => {
    const p = schema.pagination
      .extend({
        shareholderId: schema.id.optional(),
        shareClassId: schema.id.optional(),
      })
      .parse(req.query);
    const rows = await service.listHoldings(
      { shareholderId: p.shareholderId, shareClassId: p.shareClassId },
      p.limit,
      p.offset,
    );
    res.json(
      rows.map((row) => ({
        ...row,
        verificationRequired: row.verifiedAt === null,
        ownershipPercentage: row.verifiedAt
          ? ownershipPercentage(row.quantity, row.shareClass.issuedShares)
          : null,
      })),
    );
  });
  adminRouter.post("/holdings/openings", async (req, res) => {
    res
      .status(201)
      .json(await service.open(context(res), schema.opening.parse(req.body)));
  });
  adminRouter.post("/holdings/:id/adjustments", async (req, res) => {
    res
      .status(201)
      .json(
        await service.adjust(
          context(res),
          schema.id.parse(req.params.id),
          schema.adjustment.parse(req.body),
        ),
      );
  });
  adminRouter.post("/holdings/:id/verify", async (req, res) => {
    res.json(
      await service.verify(
        context(res),
        schema.id.parse(req.params.id),
        schema.verification.parse(req.body),
      ),
    );
  });
  adminRouter.get("/holdings/:id", async (req, res) => {
    const row = await service.getHolding(schema.id.parse(req.params.id));
    res.json({
      ...row,
      verificationRequired: row.verifiedAt === null,
      ownershipPercentage: row.verifiedAt
        ? ownershipPercentage(row.quantity, row.shareClass.issuedShares)
        : null,
    });
  });
  adminRouter.get("/holdings/:id/events", async (req, res) => {
    const id = schema.id.parse(req.params.id);
    await db.shareholding.findUniqueOrThrow({ where: { id } });
    const p = schema.pagination.parse(req.query);
    res.json(
      await db.holdingEvent.findMany({
        where: { holdingId: id },
        take: p.limit,
        skip: p.offset,
        orderBy: { sequence: "asc" },
      }),
    );
  });
  adminRouter.get("/audit-logs", async (req, res) => {
    const p = schema.pagination
      .extend({ targetId: schema.id.optional() })
      .parse(req.query);
    res.json(
      await db.auditLog.findMany({
        where: { targetId: p.targetId },
        take: p.limit,
        skip: p.offset,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });
  router.use("/admin", adminRouter);
  router.get("/me/holdings", auth, async (req, res) => {
    const p = schema.pagination.parse(req.query);
    const rows = await service.listHoldings(
      { userId: res.locals.user.id },
      p.limit,
      p.offset,
    );
    res.json(
      rows.map((row) => ({
        ...row,
        ownershipPercentage: ownershipPercentage(
          row.quantity,
          row.shareClass.issuedShares,
        ),
      })),
    );
  });
  router.get("/me/holdings/:id", auth, async (req, res) => {
    const row = await service.getHolding(
      schema.id.parse(req.params.id),
      res.locals.user.id,
    );
    res.json({
      ...row,
      ownershipPercentage: ownershipPercentage(
        row.quantity,
        row.shareClass.issuedShares,
      ),
    });
  });
  // No shareholder-accessible audit feed: staff correction history stays administrative.
  return router;
}
