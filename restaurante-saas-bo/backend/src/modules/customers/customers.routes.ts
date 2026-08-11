import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler, HttpError } from "../../middleware/errorHandler";
import { requireAuth } from "../../middleware/auth";

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const search = typeof req.query.q === "string" ? req.query.q : undefined;
    const customers = await prisma.customer.findMany({
      where: {
        companyId: req.auth!.companyId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { documentNumber: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(customers);
  })
);

const customerSchema = z.object({
  name: z.string().min(1),
  documentType: z.enum(["NIT", "CI", "CEX", "PASAPORTE", "OTRO", "SIN_NOMBRE"]).default("SIN_NOMBRE"),
  documentNumber: z.string().default("99001"),
  complement: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

customersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = customerSchema.parse(req.body);
    const customer = await prisma.customer.create({ data: { ...data, companyId: req.auth!.companyId } });
    res.status(201).json(customer);
  })
);

customersRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!customer) throw new HttpError(404, "Cliente no encontrado");
    const data = customerSchema.partial().parse(req.body);
    const updated = await prisma.customer.update({ where: { id: customer.id }, data });
    res.json(updated);
  })
);
