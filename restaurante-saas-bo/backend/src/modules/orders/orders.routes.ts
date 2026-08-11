import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { asyncHandler, HttpError } from "../../middleware/errorHandler";
import { requireAuth } from "../../middleware/auth";

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

ordersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const orders = await prisma.order.findMany({
      where: {
        companyId: req.auth!.companyId,
        ...(req.auth!.branchId ? { branchId: req.auth!.branchId } : {}),
        ...(status ? { status: status as any } : {}),
      },
      include: { items: true, customer: true, payments: true, invoice: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(orders);
  })
);

ordersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
      include: { items: true, customer: true, payments: true, invoice: true },
    });
    if (!order) throw new HttpError(404, "Pedido no encontrado");
    res.json(order);
  })
);

const orderItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
  notes: z.string().optional(),
});

const createOrderSchema = z.object({
  branchId: z.string(),
  type: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]).default("TAKEAWAY"),
  tableNumber: z.string().optional(),
  customerId: z.string().optional(),
  items: z.array(orderItemSchema).min(1),
  discount: z.number().nonnegative().default(0),
});

ordersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createOrderSchema.parse(req.body);

    const products = await prisma.product.findMany({
      where: { id: { in: data.items.map((i) => i.productId) }, companyId: req.auth!.companyId },
    });
    if (products.length !== new Set(data.items.map((i) => i.productId)).size) {
      throw new HttpError(400, "Uno o mas productos no existen");
    }
    const productMap = new Map(products.map((p) => [p.id, p]));

    let subtotal = new Prisma.Decimal(0);
    const itemsData = data.items.map((item) => {
      const product = productMap.get(item.productId)!;
      const lineSubtotal = product.price.mul(item.quantity);
      subtotal = subtotal.add(lineSubtotal);
      return {
        productId: product.id,
        productName: product.name,
        unitPrice: product.price,
        quantity: item.quantity,
        notes: item.notes,
        subtotal: lineSubtotal,
      };
    });

    const discount = new Prisma.Decimal(data.discount);
    const total = subtotal.sub(discount);
    if (total.lte(0)) throw new HttpError(400, "El total del pedido debe ser mayor a 0");

    const order = await prisma.order.create({
      data: {
        companyId: req.auth!.companyId,
        branchId: data.branchId,
        type: data.type,
        tableNumber: data.tableNumber,
        customerId: data.customerId,
        createdById: req.auth!.userId,
        subtotal,
        discount,
        total,
        items: { create: itemsData },
      },
      include: { items: true },
    });

    res.status(201).json(order);
  })
);

const statusSchema = z.object({
  status: z.enum(["OPEN", "IN_PREPARATION", "READY", "DELIVERED", "CANCELLED"]),
});

ordersRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!order) throw new HttpError(404, "Pedido no encontrado");
    if (order.status === "PAID") throw new HttpError(409, "El pedido ya fue facturado/pagado");

    const data = statusSchema.parse(req.body);
    const updated = await prisma.order.update({ where: { id: order.id }, data: { status: data.status } });
    res.json(updated);
  })
);

const paymentSchema = z.object({
  method: z.enum(["CASH", "CARD", "QR_SIMPLE", "OTHER"]),
  amount: z.number().positive(),
  receivedAmount: z.number().positive().optional(),
});

// Registra un pago sobre el pedido. Cuando la suma de pagos cubre el total,
// el pedido pasa a estado PAID (queda listo para emitir la factura).
ordersRouter.post(
  "/:id/payments",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
      include: { payments: true },
    });
    if (!order) throw new HttpError(404, "Pedido no encontrado");
    if (order.status === "PAID") throw new HttpError(409, "El pedido ya esta pagado");
    if (order.status === "CANCELLED") throw new HttpError(409, "El pedido esta cancelado");

    const data = paymentSchema.parse(req.body);
    const changeAmount =
      data.method === "CASH" && data.receivedAmount ? data.receivedAmount - data.amount : undefined;
    if (changeAmount !== undefined && changeAmount < 0) {
      throw new HttpError(400, "El monto recibido es menor al monto a pagar");
    }

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        method: data.method,
        amount: data.amount,
        receivedAmount: data.receivedAmount,
        changeAmount,
      },
    });

    const paidSoFar = order.payments
      .reduce((acc, p) => acc.add(p.amount), new Prisma.Decimal(0))
      .add(data.amount);

    if (paidSoFar.gte(order.total)) {
      await prisma.order.update({ where: { id: order.id }, data: { status: "PAID" } });
    }

    res.status(201).json(payment);
  })
);
