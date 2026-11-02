import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Story, Layout } from "@campus/contracts";
import { deriveEdges } from "./editorModel";

type Props = {
  story: Story;
  layout: Layout;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onViewportChange: (viewport: Layout["viewport"]) => void;
  onPositionsChange: (positions: Layout["positions"]) => void;
};

/**
 * 右侧画布。
 * - 节点只读故事标题，位置来自 layout.positions（只有 ID + X/Y）。
 * - 连线由 choices 实时推导，画布不允许手动连线。
 */
export function StoryCanvas({
  story,
  layout,
  selectedNodeId,
  onSelectNode,
  onPositionsChange,
  onViewportChange,
}: Props) {
  const nodes: Node[] = useMemo(
    () =>
      story.nodes.map((n) => ({
        id: n.id,
        type: n.kind === "ending" ? "output" : "default",
        position: layout.positions[n.id] ?? { x: 0, y: 0 },
        data: { label: n.title },
        className: n.id === selectedNodeId ? "story-node--selected" : undefined,
      })),
    [story, layout, selectedNodeId],
  );

  const edges: Edge[] = useMemo(() => deriveEdges(story), [story]);

  const handleNodesChange: OnNodesChange = (changes) => {
    const next = { ...layout.positions };
    let changed = false;
    for (const c of changes) {
      if (c.type === "position" && c.position) {
        next[c.id] = { x: c.position.x, y: c.position.y };
        changed = true;
      }
    }
    if (changed) onPositionsChange(next);
  };

  return (
    <div className="author-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode("")}
        nodesConnectable={false}
        edgesReconnectable={false}
        defaultViewport={layout.viewport}
        onMoveEnd={(_, viewport) => onViewportChange(viewport)}
        fitViewOptions={{ padding: 0.3 }}
      >
        <Background color="var(--ui-grid)" gap={24} size={1} />
        <Controls />
        <MiniMap nodeColor="var(--ui-gold-soft)" maskColor="#eee7d899" />
      </ReactFlow>
    </div>
  );
}
