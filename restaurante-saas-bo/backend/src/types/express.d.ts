import { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        companyId: string;
        branchId: string | null;
        role: Role;
      };
    }
  }
}

export {};
