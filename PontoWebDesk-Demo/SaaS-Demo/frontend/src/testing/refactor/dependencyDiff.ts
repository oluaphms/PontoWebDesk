export type DependencySnapshot = {
  nodes: number;
  edges: number;
};

export function diffDependencySnapshot(before: DependencySnapshot, after: DependencySnapshot): DependencySnapshot {
  return {
    nodes: after.nodes - before.nodes,
    edges: after.edges - before.edges,
  };
}
