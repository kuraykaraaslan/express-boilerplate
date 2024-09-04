import { PrismaClient as Orginal, User } from "@prisma/client";

const PrismaClient = new Orginal();

export type { User };

export default {
  PrismaClient,
};
