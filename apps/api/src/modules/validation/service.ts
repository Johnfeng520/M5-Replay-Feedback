import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { validateStory, VALIDATOR_VERSION } from "@campus/engine";
import {
  LIMITS,
  type Story,
  type Asset,
  type ValidationReport,
} from "@campus/contracts";
import {
  snapshotDigest,
  transact,
  BusinessError,
} from "../../infrastructure/core";
import { authoringService } from "../authoring";
export class CheckError extends BusinessError {
  constructor(
    public status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(status, code, message, details);
  }
}
export function snapshotDigestOf(story: Story, assets: Asset[] = []): string {
  return snapshotDigest(story, assets);
}
export function validationService(db: PrismaClient) {
  const author = authoringService(db);
  return {
    async runCheck(input: {
      activityId: string;
      userId: string;
      expectedRevision: number;
    }): Promise<ValidationReport> {
      const candidate = await transact(db, async (tx) => {
        try {
          return await author.captureOwned(
            tx,
            input.userId,
            input.activityId,
            input.expectedRevision,
          );
        } catch (e) {
          if (e instanceof BusinessError) {
            if (e.code === "REVISION_CONFLICT") {
              const row = await tx.draft.findUnique({
                where: { activityId: input.activityId },
              });
              throw new CheckError(409, e.code, e.message, {
                expectedRevision: input.expectedRevision,
                currentRevision: row?.revision,
              });
            }
            throw new CheckError(e.statusCode, e.code, e.message, e.details);
          }
          throw e;
        }
      });
      return {
        reportId: randomUUID(),
        activityId: input.activityId,
        revision: candidate.revision,
        snapshotDigest: snapshotDigest(candidate.story, candidate.assets),
        validatorVersion: VALIDATOR_VERSION,
        ...validateStory(candidate.story, {
          maxStates: LIMITS.states,
          maxTimeMs: LIMITS.timeMs,
        }),
      };
    },
  };
}
export type ValidationService = ReturnType<typeof validationService>;
