import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireRole } from "../../middleware/auth";

export const branchesRouter = Router();
branchesRouter.use(requireAuth);

branchesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const branches = await prisma.branch.findMany({
      where: { companyId: req.auth!.companyId },
      include: { fiscalConfig: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(branches);
  })
);

const branchSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional(),
  municipio: z.string().optional(),
  departamento: z.string().optional(),
  phone: z.string().optional(),
});

branchesRouter.post(
  "/",
  requireRole("OWNER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const data = branchSchema.parse(req.body);
    const branch = await prisma.branch.create({
      data: { ...data, companyId: req.auth!.companyId },
    });

    // Cada sucursal nueva necesita su propia config fiscal y correlativo de
    // facturas, ya que el SIN asigna codigoSucursal/codigoPuntoVenta por sucursal.
    const company = await prisma.company.findUniqueOrThrow({ where: { id: req.auth!.companyId } });
    await prisma.fiscalConfig.create({
      data: { branchId: branch.id, nit: company.nit, razonSocial: company.razonSocial, environment: "TEST" },
    });
    await prisma.invoiceSequence.create({ data: { branchId: branch.id, lastNumber: 0 } });

    res.status(201).json(branch);
  })
);

branchesRouter.patch(
  "/:id",
  requireRole("OWNER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const data = branchSchema.partial().parse(req.body);
    const branch = await prisma.branch.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!branch) throw new HttpError(404, "Sucursal no encontrada");
    const updated = await prisma.branch.update({ where: { id: branch.id }, data });
    res.json(updated);
  })
);

const fiscalConfigSchema = z.object({
  environment: z.enum(["TEST", "PRODUCTION"]).optional(),
  codigoSucursal: z.number().int().optional(),
  codigoPuntoVenta: z.number().int().optional(),
  codigoSistema: z.string().optional(),
  cuis: z.string().optional(),
});

// Permite cargar los datos que entrega el SIN al homologar el sistema
// (codigo de sucursal/punto de venta, codigo de sistema, CUIS).
branchesRouter.patch(
  "/:id/fiscal-config",
  requireRole("OWNER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const branch = await prisma.branch.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!branch) throw new HttpError(404, "Sucursal no encontrada");

    const data = fiscalConfigSchema.parse(req.body);
    const updated = await prisma.fiscalConfig.update({
      where: { branchId: branch.id },
      data: {
        ...data,
        cuisFechaVigencia: data.cuis ? new Date() : undefined,
      },
    });
    res.json(updated);
  })
);
