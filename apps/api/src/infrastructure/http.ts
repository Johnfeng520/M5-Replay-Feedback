import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { tokenHash } from "../auth";
import { ensure } from "./core";
export async function currentUser(db: PrismaClient, req: FastifyRequest) {
  const token = req.cookies.sid;
  if (!token) return null;
  const s = await db.authSession.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });
  return s && s.expiresAt.getTime() > Date.now() ? s.user : null;
}
export async function requireUser(db: PrismaClient, req: FastifyRequest) {
  const u = await currentUser(db, req);
  ensure(u, 401, "UNAUTHENTICATED", "请先登录");
  return u;
}
export const requestIdSchema = { type: "string", minLength: 1, maxLength: 64 };
export const revisionSchema = { type: "integer", minimum: 1 };
export const sequenceSchema = { type: "integer", minimum: 0 };
export const body = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
