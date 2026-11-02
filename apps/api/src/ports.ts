import type { PrismaClient } from "@prisma/client";
import type {
  EventPort,
  ExecutionPort,
  SavePort,
  VersionPort,
  ValidationPort,
  RulePort,
} from "@campus/contracts/ports";
import {
  validateStory,
  validateStructure,
  initialState,
  getChoices,
  applyChoice,
} from "@campus/engine";
import { playerService } from "./modules/player";
import { saveService } from "./modules/saves";
import { loadVersion } from "./modules/versions";
import { appendEvent } from "./modules/events";
import type { Tx } from "./infrastructure/core";
// Compile-time checks keep the distributed work-package ports executable and stable.
export const versionPort: VersionPort<Tx> = { loadVersion };
export const eventPort: EventPort<Tx> = { appendEvent };
export const rulePort: RulePort = { initialState, getChoices, applyChoice };
export const validationPort: ValidationPort = {
  validateStory,
  validateStructure,
};
export function executionPort(db: PrismaClient): ExecutionPort {
  const s = playerService(db);
  return {
    executeChoice: (actorId, sessionId, input) =>
      s.executeChoice({ ...input, playerId: actorId, sessionId }),
  };
}
export const savesPort = (db: PrismaClient): SavePort => saveService(db);
