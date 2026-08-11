import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireRole } from "../../middleware/auth";

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { companyId: req.auth!.companyId },
      select: { id: true, name: true, email: true, role: true, active: true, branchId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(users);
  })
);

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "CASHIER", "KITCHEN"]),
  branchId: z.string().optional(),
});

usersRouter.post(
  "/",
  requireRole("OWNER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new HttpError(409, "Ya existe un usuario con ese email");

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        companyId: req.auth!.companyId,
        branchId: data.branchId,
        name: data.name,
        email: data.email,
        passwordHash,
        role: data.role,
      },
    });
    res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
  })
);

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  role: z.enum(["ADMIN", "CASHIER", "KITCHEN"]).optional(),
  branchId: z.string().optional(),
  active: z.boolean().optional(),
});

usersRouter.patch(
  "/:id",
  requireRole("OWNER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!user) throw new HttpError(404, "Usuario no encontrado");
    const data = updateSchema.parse(req.body);
    const updated = await prisma.user.update({ where: { id: user.id }, data });
    res.json({ id: updated.id, name: updated.name, role: updated.role, active: updated.active });
  })
);
