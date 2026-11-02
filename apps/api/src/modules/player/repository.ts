import type { RuntimeState } from "@campus/contracts";
import { ownedSession, ensure, type Tx } from "../../infrastructure/core";
export const playerRepository = {
  readOwned: ownedSession,
  async advance(
    tx: Tx,
    id: string,
    expectedSeq: number,
    state: RuntimeState,
    status: string,
  ) {
    const changed = await tx.playSession.updateMany({
      where: { id, seq: expectedSeq },
      data: { state: state as any, seq: { increment: 1 }, status },
    });
    ensure(
      changed.count === 1,
      409,
      "SEQUENCE_CONFLICT",
      "进度已变化，请重新读取",
    );
  },
};
