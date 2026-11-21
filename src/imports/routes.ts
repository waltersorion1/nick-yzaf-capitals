import { Router, type RequestHandler, type Response } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { id, reason, pagination } from "../records/validation.js";
import { ImportService } from "./service.js";
import { HEADERS, MAX_BYTES } from "./csv.js";
export function importRoutes(
  db: PrismaClient,
  auth: RequestHandler,
  admin: RequestHandler,
) {
  const router = Router(),
    imports = Router(),
    service = new ImportService(db);
  const context = (res: Response) => ({
    actorId: res.locals.user.id as string,
    requestId: res.locals.requestId as string,
  });
  router.get("/admin/users", auth, admin, async (req, res) => {
    const p = pagination.parse(req.query);
    res.json(
      await db.user.findMany({
        select: {
          id: true,
          email: true,
          role: true,
          active: true,
          shareholder: { select: { id: true, legalName: true } },
        },
        orderBy: { id: "asc" },
        take: p.limit,
        skip: p.offset,
      }),
    );
  });
  imports.use(auth, admin);
  imports.get("/template", (_req, res) => {
    res
      .type("text/csv")
      .attachment("verified-openings-template.csv")
      .send(HEADERS.join(",") + "\r\n");
  });
  imports.get("/", async (req, res) => {
    const p = pagination.parse(req.query);
    res.json(
      await db.openingImportBatch.findMany({
        where: { actorId: res.locals.user.id },
        select: {
          id: true,
          contentHash: true,
          createdAt: true,
          expiresAt: true,
          committedAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: p.limit,
        skip: p.offset,
      }),
    );
  });
  imports.post("/preview", async (req, res) => {
    const input = z
      .object({ csv: z.string().min(1).max(MAX_BYTES), reason })
      .strict()
      .parse(req.body);
    res.status(201).json(await service.preview(context(res), input));
  });
  imports.get("/:id", async (req, res) =>
    res.json(await service.get(res.locals.user.id, id.parse(req.params.id))),
  );
  imports.post("/:id/commit", async (req, res) => {
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    const result = await service.commit(context(res), id.parse(req.params.id));
    res.status("conflict" in result ? 409 : 200).json(result);
  });
  router.use("/admin/imports", imports);
  return router;
}
