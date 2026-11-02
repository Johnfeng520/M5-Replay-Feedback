import { validateStructure } from "@campus/engine";
import { api, ApiError } from "../api";
import type { DraftState } from "./editorModel";
export class RevisionConflictError extends Error {}
export async function saveDraft(draft: DraftState): Promise<DraftState> {
  if (validateStructure(draft.story).some((i) => i.code === "SCHEMA_INVALID"))
    throw new Error("请检查必填字段、目标节点、变量及内容数量后再保存");
  try {
    return await api(`/activities/${draft.activityId}/draft`, {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: draft.revision,
        story: draft.story,
        layout: draft.layout,
      }),
    });
  } catch (e) {
    if (e instanceof ApiError && e.code === "REVISION_CONFLICT")
      throw new RevisionConflictError(
        "草稿已有新修订；本地编辑仍保留，请另行备份后重新读取。",
      );
    throw e;
  }
}
