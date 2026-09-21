import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { clusterColor, CLUSTER_PALETTE } from '../App.jsx';

const FUENTE_ICONS = {
  pdf: '⬛', tesis: '⬛', youtube: '▶', excel: '⊞', html: '⊡',
  word: '⬛', ppt: '◳', image: '▣', audio: '♫', video: '▶',
  concepto: '◈', script: '⚙',
};

function groupKey(node) {
  const t = node.tema;
  if (t && t !== 'Sin clasificar') return 't:' + t;
  if (node.cluster != null && node.cluster >= 0) return 'c:' + node.cluster;
  return null;
}

function groupColor(key) {
  if (key == null) return '#565A78';
  if (key.startsWith('c:')) return clusterColor(parseInt(key.slice(2), 10));
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return CLUSTER_PALETTE[h % CLUSTER_PALETTE.length];
}

function DocumentNode({ data, selected }) {
  const color = data.color || '#565A78';
  const icon = FUENTE_ICONS[data.fuente] || '◈';
  const isScript = data.fuente === 'script' || data.type === 'SCRIPT';
  
  return (
    <div
      className={`graph2d-node ${selected ? 'selected' : ''} ${data.dimmed ? 'dimmed' : ''}`}
      style={{
        borderColor: selected ? '#fff' : color,
        background: selected 
          ? `linear-gradient(135deg, ${color}40, ${color}20)` 
          : 'rgba(13, 16, 22, 0.95)',
      }}
    >
      <div className="graph2d-node-icon" style={{ color }}>
        {icon}
      </div>
      <div className="graph2d-node-content">
        <div className="graph2d-node-label">{data.label}</div>
        {data.tema && (
          <div className="graph2d-node-tema" style={{ color }}>
            {data.tema}
          </div>
        )}
      </div>
      {isScript && <div className="graph2d-node-badge">SCRIPT</div>}
      {data.is_hub && <div className="graph2d-node-hub">★</div>}
    </div>
  );
}

const nodeTypes = { document: DocumentNode };

const SCALE = 8;

export default function Graph2D({
  graphData,
  selectedNode,
  highlighted,
  filteredIds,
  onNodeClick,
  onLinkClick,
  layoutMode = 'components',
}) {
  const containerRef = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const processedData = useMemo(() => {
    if (!graphData.nodes.length) return { nodes: [], edges: [] };

    const flowNodes = graphData.nodes
      .filter(n => !filteredIds || filteredIds.has(n.id))
      .map(n => {
        const gk = groupKey(n);
        const color = n.is_issue ? '#D4A55A' : groupColor(gk);
        const isDimmed = highlighted.size > 0 && !highlighted.has(n.id);
        
        let x = 0, y = 0;
        if (layoutMode === 'components' && n.x3d !== undefined) {
          x = n.x3d * SCALE;
          y = -n.y3d * SCALE;
        } else if (n.x !== undefined) {
          x = n.x * SCALE;
          y = -n.y * SCALE;
        } else {
          x = Math.random() * 800;
          y = Math.random() * 600;
        }

        return {
          id: n.id,
          type: 'document',
          position: { x, y },
          data: {
            label: n.label,
            fuente: n.fuente,
            tema: n.tema,
            color,
            dimmed: isDimmed,
            is_hub: n.is_hub,
            type: n.type,
            original: n,
          },
          selected: selectedNode?.id === n.id,
        };
      });

    const nodeIds = new Set(flowNodes.map(n => n.id));
    
    const flowEdges = graphData.links
      .filter(l => {
        const s = l.source?.id ?? l.source;
        const t = l.target?.id ?? l.target;
        return nodeIds.has(s) && nodeIds.has(t);
      })
      .map((l, i) => {
        const s = l.source?.id ?? l.source;
        const t = l.target?.id ?? l.target;
        const sourceNode = graphData.nodes.find(n => n.id === s);
        const targetNode = graphData.nodes.find(n => n.id === t);
        
        const gkS = sourceNode ? groupKey(sourceNode) : null;
        const gkT = targetNode ? groupKey(targetNode) : null;
        const sameGroup = gkS != null && gkS === gkT;
        
        const isHighlighted = highlighted.size > 0 && 
          (highlighted.has(s) || highlighted.has(t));
        
        let color = 'rgba(100, 120, 150, 0.25)';
        if (sameGroup) {
          color = `${groupColor(gkS)}60`;
        }
        if (isHighlighted) {
          color = sameGroup ? `${groupColor(gkS)}90` : 'rgba(150, 170, 200, 0.6)';
        }

        return {
          id: `e-${i}-${s}-${t}`,
          source: s,
          target: t,
          type: 'default',
          animated: false,
          style: { 
            stroke: color,
            strokeWidth: isHighlighted ? 2 : 1,
          },
          data: { original: l },
        };
      });

    return { nodes: flowNodes, edges: flowEdges };
  }, [graphData, selectedNode, highlighted, filteredIds, layoutMode]);

  useEffect(() => {
    setNodes(processedData.nodes);
    setEdges(processedData.edges);
  }, [processedData, setNodes, setEdges]);

  const handleNodeClick = useCallback((event, node) => {
    if (onNodeClick && node.data?.original) {
      onNodeClick(node.data.original, event);
    }
  }, [onNodeClick]);

  const handleEdgeClick = useCallback((event, edge) => {
    if (onLinkClick && edge.data?.original) {
      onLinkClick(edge.data.original, event);
    }
  }, [onLinkClick]);

  const minimapNodeColor = useCallback((node) => {
    return node.data?.color || '#565A78';
  }, []);

  return (
    <div className="graph2d-container" ref={containerRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnScroll={true}
        zoomOnScroll={true}
        proOptions={{ hideAttribution: true }}
      >
        <Background 
          color="rgba(100, 120, 150, 0.08)" 
          gap={24} 
          size={1}
        />
        <Controls 
          className="graph2d-controls"
          showInteractive={false}
        />
        <MiniMap 
          className="graph2d-minimap"
          nodeColor={minimapNodeColor}
          maskColor="rgba(8, 10, 14, 0.85)"
          style={{
            background: 'rgba(13, 16, 22, 0.9)',
            border: '1px solid rgba(100, 120, 150, 0.2)',
          }}
        />
      </ReactFlow>
    </div>
  );
}
