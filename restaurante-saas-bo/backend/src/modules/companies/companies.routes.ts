import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../middleware/errorHandler";
import { requireAuth, requireRole } from "../../middleware/auth";

export const companiesRouter = Router();
companiesRouter.use(requireAuth);

companiesRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: req.auth!.companyId },
      include: { branches: true },
    });
    res.json(company);
  })
);

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  razonSocial: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

companiesRouter.patch(
  "/me",
  requireRole("OWNER"),
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const company = await prisma.company.update({
      where: { id: req.auth!.companyId },
      data,
    });
    res.json(company);
  })
);
