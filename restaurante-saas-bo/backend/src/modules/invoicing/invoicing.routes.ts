import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { asyncHandler, HttpError } from "../../middleware/errorHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { cancelInvoice, issueInvoiceForOrder } from "./invoicing.service";

export const invoicingRouter = Router();
invoicingRouter.use(requireAuth);

invoicingRouter.get(
  "/invoices",
  asyncHandler(async (req, res) => {
    const invoices = await prisma.invoice.findMany({
      where: { companyId: req.auth!.companyId },
      include: { customer: true, order: true },
      orderBy: { fechaEmision: "desc" },
      take: 100,
    });
    res.json(invoices);
  })
);

invoicingRouter.get(
  "/invoices/:id",
  asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
      include: { customer: true, order: { include: { items: true } }, branch: true },
    });
    if (!invoice) throw new HttpError(404, "Factura no encontrada");
    res.json(invoice);
  })
);

invoicingRouter.post(
  "/orders/:orderId/issue",
  requireRole("OWNER", "ADMIN", "CASHIER"),
  asyncHandler(async (req, res) => {
    const invoice = await issueInvoiceForOrder(req.auth!.companyId, req.params.orderId, req.auth!.userId);
    res.status(201).json(invoice);
  })
);

const cancelSchema = z.object({ motivo: z.string().min(3) });

invoicingRouter.post(
  "/invoices/:id/cancel",
  requireRole("OWNER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { motivo } = cancelSchema.parse(req.body);
    const invoice = await cancelInvoice(req.auth!.companyId, req.params.id, motivo);
    res.json(invoice);
  })
);
