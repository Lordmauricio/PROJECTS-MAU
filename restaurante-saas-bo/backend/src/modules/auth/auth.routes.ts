import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler, HttpError } from "../../middleware/errorHandler";
import { signToken } from "../../middleware/auth";

export const authRouter = Router();

const registerSchema = z.object({
  companyName: z.string().min(2),
  razonSocial: z.string().min(2),
  nit: z.string().min(5),
  branchName: z.string().min(2).default("Casa Matriz"),
  ownerName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

// Registra una nueva empresa (tenant) con su primera sucursal y el usuario dueno.
authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      throw new HttpError(409, "Ya existe un usuario con ese email");
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: data.companyName,
          razonSocial: data.razonSocial,
          nit: data.nit,
        },
      });

      const branch = await tx.branch.create({
        data: {
          companyId: company.id,
          name: data.branchName,
          isMatriz: true,
        },
      });

      await tx.fiscalConfig.create({
        data: {
          branchId: branch.id,
          nit: data.nit,
          razonSocial: data.razonSocial,
          environment: "TEST",
        },
      });

      await tx.invoiceSequence.create({
        data: { branchId: branch.id, lastNumber: 0 },
      });

      const user = await tx.user.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          name: data.ownerName,
          email: data.email,
          passwordHash,
          role: "OWNER",
        },
      });

      return { company, branch, user };
    });

    const token = signToken({
      userId: result.user.id,
      companyId: result.company.id,
      branchId: result.branch.id,
      role: result.user.role,
    });

    res.status(201).json({
      token,
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        branchId: result.branch.id,
      },
      company: { id: result.company.id, name: result.company.name },
      branch: { id: result.branch.id, name: result.branch.name },
    });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !user.active) {
      throw new HttpError(401, "Credenciales invalidas");
    }
    const valid = await bcrypt.compare(data.password, user.passwordHash);
    if (!valid) {
      throw new HttpError(401, "Credenciales invalidas");
    }

    const token = signToken({
      userId: user.id,
      companyId: user.companyId,
      branchId: user.branchId,
      role: user.role,
    });

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId },
    });
  })
);
