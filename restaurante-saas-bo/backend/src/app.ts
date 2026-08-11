import express from "express";
import cors from "cors";
import { authRouter } from "./modules/auth/auth.routes";
import { companiesRouter } from "./modules/companies/companies.routes";
import { branchesRouter } from "./modules/branches/branches.routes";
import { usersRouter } from "./modules/users/users.routes";
import { menuRouter } from "./modules/menu/menu.routes";
import { customersRouter } from "./modules/customers/customers.routes";
import { ordersRouter } from "./modules/orders/orders.routes";
import { invoicingRouter } from "./modules/invoicing/invoicing.routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/auth", authRouter);
app.use("/companies", companiesRouter);
app.use("/branches", branchesRouter);
app.use("/users", usersRouter);
app.use("/menu", menuRouter);
app.use("/customers", customersRouter);
app.use("/orders", ordersRouter);
app.use("/invoicing", invoicingRouter);

app.use(notFoundHandler);
app.use(errorHandler);
