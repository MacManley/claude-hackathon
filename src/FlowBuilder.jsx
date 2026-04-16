import { useCallback, useState, useRef } from 'react';
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const PRESET_PROMPTS = [
  'Ask about my background and motivation for this role',
  'Assess my technical problem-solving skills',
  'Evaluate my teamwork and communication abilities',
  'Test my knowledge of system design concepts',
  'Give me a behavioural STAR-format question',
  'Challenge me with a curveball or creative scenario',
  'Probe my leadership and decision-making experience',
  'Ask about a time I dealt with conflict or failure',
];

function StageNode({ id, data }) {
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef(null);

  const handleDoubleClick = () => {
    setIsEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  return (
    <div
      className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 w-[200px] sm:min-w-[240px] sm:max-w-[300px] shadow-lg"
      onDoubleClick={handleDoubleClick}
    >
      <Handle type="target" position={Position.Top} className="!bg-teal-400 !w-3 !h-3" />
      <div className="flex items-center justify-between mb-1.5 sm:mb-2">
        <span className="text-[9px] sm:text-[10px] uppercase tracking-widest text-teal-300 font-medium">
          Stage {data.stageNumber}
        </span>
        <button
          onClick={() => data.onDelete(id)}
          className="text-slate-500 hover:text-rose-400 text-xs leading-none"
        >
          ×
        </button>
      </div>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={data.prompt}
          onChange={(e) => data.onPromptChange(id, e.target.value)}
          onBlur={() => setIsEditing(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setIsEditing(false); }}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs sm:text-sm text-slate-200 resize-none outline-none focus:border-teal-400/60"
          rows={3}
        />
      ) : (
        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed cursor-text">
          {data.prompt || 'Double-click to edit...'}
        </p>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-teal-400 !w-3 !h-3" />
    </div>
  );
}

function StageCard({ stage, index, total, onPromptChange, onDelete, onMoveUp, onMoveDown }) {
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef(null);

  return (
    <div className="bg-slate-900/80 border border-slate-700/80 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-teal-300 font-medium">
          Stage {index + 1}
        </span>
        <div className="flex items-center gap-2">
          {index > 0 && (
            <button onClick={onMoveUp} className="text-slate-500 hover:text-slate-300 text-xs">↑</button>
          )}
          {index < total - 1 && (
            <button onClick={onMoveDown} className="text-slate-500 hover:text-slate-300 text-xs">↓</button>
          )}
          <button onClick={onDelete} className="text-slate-500 hover:text-rose-400 text-xs">×</button>
        </div>
      </div>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          autoFocus
          value={stage.prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onBlur={() => setIsEditing(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setIsEditing(false); }}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-slate-200 resize-none outline-none focus:border-teal-400/60"
          rows={2}
        />
      ) : (
        <p
          onClick={() => {
            setIsEditing(true);
            setTimeout(() => textareaRef.current?.focus(), 0);
          }}
          className="text-sm text-slate-300 leading-relaxed cursor-text"
        >
          {stage.prompt || 'Tap to edit prompt...'}
        </p>
      )}
      {index < total - 1 && (
        <div className="flex justify-center mt-2 text-teal-400/50 text-lg leading-none">↓</div>
      )}
    </div>
  );
}

const nodeTypes = { stageNode: StageNode };

let nodeIdCounter = 0;
function getNextId() {
  nodeIdCounter += 1;
  return `stage-${nodeIdCounter}`;
}

function buildInitialNodes() {
  const id = getNextId();
  return [
    {
      id,
      type: 'stageNode',
      position: { x: 80, y: 60 },
      data: {
        prompt: 'Ask about my background and motivation for this role',
        stageNumber: 1,
        onPromptChange: () => {},
        onDelete: () => {},
      },
    },
  ];
}

export default function FlowBuilder({ onSave, onCancel }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(buildInitialNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [showPresets, setShowPresets] = useState(false);

  const [mobileStages, setMobileStages] = useState([
    { id: 'ms-1', prompt: 'Ask about my background and motivation for this role' },
  ]);
  let mobileIdCounter = useRef(1);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: '#2dd4bf' } }, eds)),
    [setEdges]
  );

  const updatePrompt = useCallback((nodeId, newPrompt) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, prompt: newPrompt } } : n
      )
    );
  }, [setNodes]);

  const deleteNode = useCallback((nodeId) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
  }, [setNodes, setEdges]);

  const injectCallbacks = useCallback(
    (nds) =>
      nds.map((n, i) => ({
        ...n,
        data: { ...n.data, stageNumber: i + 1, onPromptChange: updatePrompt, onDelete: deleteNode },
      })),
    [updatePrompt, deleteNode]
  );

  const addNode = useCallback(
    (prompt = '') => {
      const id = getNextId();
      const yOffset = nodes.length * 140 + 60;
      const newNode = {
        id,
        type: 'stageNode',
        position: { x: 80, y: yOffset },
        data: {
          prompt,
          stageNumber: nodes.length + 1,
          onPromptChange: updatePrompt,
          onDelete: deleteNode,
        },
      };

      setNodes((nds) => {
        const updated = [...nds, newNode];
        if (nds.length > 0) {
          const lastNode = nds[nds.length - 1];
          setEdges((eds) => addEdge(
            { source: lastNode.id, target: id, animated: true, style: { stroke: '#2dd4bf' } },
            eds
          ));
        }
        return updated;
      });

      mobileIdCounter.current += 1;
      setMobileStages((prev) => [...prev, { id: `ms-${mobileIdCounter.current}`, prompt }]);
      setShowPresets(false);
    },
    [nodes.length, setNodes, setEdges, updatePrompt, deleteNode]
  );

  const handleSave = () => {
    const isMobile = window.innerWidth < 640;
    if (isMobile) {
      const stages = mobileStages.map((s) => s.prompt).filter(Boolean);
      if (stages.length === 0) return;
      onSave(stages);
    } else {
      const ordered = topologicalSort(nodes, edges);
      const stages = ordered.map((n) => n.data.prompt).filter(Boolean);
      if (stages.length === 0) return;
      onSave(stages);
    }
  };

  const displayNodes = injectCallbacks(nodes);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-800/60 gap-3">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-slate-100">Custom Interview Flow</h2>
          <p className="text-[11px] sm:text-xs text-slate-500">
            Add stages with prompts that guide each question.
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <div className="relative">
            <button
              onClick={() => setShowPresets(!showPresets)}
              className="rounded-xl bg-slate-100/10 hover:bg-slate-100/20 text-slate-100 font-medium px-3 sm:px-4 py-2 text-xs sm:text-sm whitespace-nowrap"
            >
              + Add stage
            </button>
            {showPresets && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowPresets(false)} />
                <div className="absolute right-0 sm:right-0 top-full mt-2 w-[calc(100vw-2rem)] sm:w-80 max-w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 p-2 max-h-72 overflow-y-auto">
                  <button
                    onClick={() => addNode('')}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-teal-300 hover:bg-slate-800 mb-1"
                  >
                    Blank stage (write your own)
                  </button>
                  <div className="border-t border-slate-800 my-1" />
                  {PRESET_PROMPTS.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => addNode(p)}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={onCancel}
            className="rounded-xl border border-slate-800/60 hover:border-slate-700 text-slate-400 hover:text-slate-200 px-3 sm:px-4 py-2 text-xs sm:text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-xl bg-teal-300 hover:bg-teal-200 text-slate-900 font-medium px-3 sm:px-4 py-2 text-xs sm:text-sm whitespace-nowrap"
          >
            Save flow
          </button>
        </div>
      </header>

      {/* Mobile: card list view */}
      <div className="flex-1 sm:hidden overflow-y-auto px-4 py-4 space-y-2">
        {mobileStages.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-10">
            Tap &quot;+ Add stage&quot; to start building your flow.
          </p>
        )}
        {mobileStages.map((stage, i) => (
          <StageCard
            key={stage.id}
            stage={stage}
            index={i}
            total={mobileStages.length}
            onPromptChange={(val) =>
              setMobileStages((prev) => prev.map((s, j) => j === i ? { ...s, prompt: val } : s))
            }
            onDelete={() => setMobileStages((prev) => prev.filter((_, j) => j !== i))}
            onMoveUp={() =>
              setMobileStages((prev) => {
                const copy = [...prev];
                [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]];
                return copy;
              })
            }
            onMoveDown={() =>
              setMobileStages((prev) => {
                const copy = [...prev];
                [copy[i + 1], copy[i]] = [copy[i], copy[i + 1]];
                return copy;
              })
            }
          />
        ))}
      </div>

      {/* Desktop: React Flow canvas */}
      <div
        className="hidden sm:block flex-1"
        style={{ height: 'calc(100vh - 72px)', width: '100%' }}
      >
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          fitView
          proOptions={{ hideAttribution: true }}
          className="bg-slate-950"
        >
          <Background color="#334155" gap={20} />
          <Controls className="!bg-slate-900 !border-slate-700 !rounded-xl [&_button]:!bg-slate-800 [&_button]:!border-slate-700 [&_button]:!text-slate-300 [&_button:hover]:!bg-slate-700" />
        </ReactFlow>
      </div>
    </div>
  );
}

function topologicalSort(nodes, edges) {
  if (nodes.length === 0) return [];
  const adjacency = {};
  const inDegree = {};
  nodes.forEach((n) => {
    adjacency[n.id] = [];
    inDegree[n.id] = 0;
  });
  edges.forEach((e) => {
    if (adjacency[e.source] && inDegree[e.target] !== undefined) {
      adjacency[e.source].push(e.target);
      inDegree[e.target] += 1;
    }
  });
  const queue = nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id);
  const sorted = [];
  while (queue.length > 0) {
    const current = queue.shift();
    sorted.push(current);
    for (const neighbor of adjacency[current] || []) {
      inDegree[neighbor] -= 1;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }
  const nodeMap = {};
  nodes.forEach((n) => { nodeMap[n.id] = n; });
  const result = sorted.map((id) => nodeMap[id]).filter(Boolean);
  const remaining = nodes.filter((n) => !sorted.includes(n.id));
  return [...result, ...remaining];
}
