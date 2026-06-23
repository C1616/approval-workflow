import { PrismaClient } from "@prisma/client";

// Single shared Prisma client instance across the app.
export const prisma = new PrismaClient();
