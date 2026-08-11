import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireRole } from "../../middleware/auth";

export const menuRouter = Router();
menuRouter.use(requireAuth);

// ---- Categorias ----

menuRouter.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { companyId: req.auth!.companyId },
      orderBy: { sortOrder: "asc" },
    });
    res.json(categories);
  })
);

const categorySchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

menuRouter.post(
  "/categories",
  requireRole("OWNER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const data = categorySchema.parse(req.body);
    const category = await prisma.category.create({ data: { ...data, companyId: req.auth!.companyId } });
    res.status(201).json(category);
  })
);

menuRouter.patch(
  "/categories/:id",
  requireRole("OWNER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!category) throw new HttpError(404, "Categoria no encontrada");
    const data = categorySchema.partial().parse(req.body);
    const updated = await prisma.category.update({ where: { id: category.id }, data });
    res.json(updated);
  })
);

menuRouter.delete(
  "/categories/:id",
  requireRole("OWNER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!category) throw new HttpError(404, "Categoria no encontrada");
    await prisma.category.update({ where: { id: category.id }, data: { active: false } });
    res.status(204).end();
  })
);

// ---- Productos ----

menuRouter.get(
  "/products",
  asyncHandler(async (req, res) => {
    const products = await prisma.product.findMany({
      where: { companyId: req.auth!.companyId, active: true },
      include: { category: true },
      orderBy: { name: "asc" },
    });
    res.json(products);
  })
);

const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  categoryId: z.string().optional(),
  imageUrl: z.string().optional(),
  sku: z.string().optional(),
  unitCode: z.string().optional(),
});

menuRouter.post(
  "/products",
  requireRole("OWNER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const data = productSchema.parse(req.body);
    const product = await prisma.product.create({ data: { ...data, companyId: req.auth!.companyId } });
    res.status(201).json(product);
  })
);

menuRouter.patch(
  "/products/:id",
  requireRole("OWNER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!product) throw new HttpError(404, "Producto no encontrado");
    const data = productSchema.partial().parse(req.body);
    const updated = await prisma.product.update({ where: { id: product.id }, data });
    res.json(updated);
  })
);

menuRouter.delete(
  "/products/:id",
  requireRole("OWNER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!product) throw new HttpError(404, "Producto no encontrado");
    await prisma.product.update({ where: { id: product.id }, data: { active: false } });
    res.status(204).end();
  })
);
