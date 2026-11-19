import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, ArrowUp, BookOpen, BrainCircuit, Check, ChevronDown, ChevronRight, Clock3, Copy, Download, ExternalLink, Eye, FilePlus2, FileText, FlaskConical, Gauge, GitBranch, Globe2, GraduationCap, HelpCircle, Image as ImageIcon, Layers3, Library, Lightbulb, ListChecks, Maximize2, Minus, MoreHorizontal, MousePointer2, Paperclip, Pencil, Pin, PinOff, Play, Plus, RotateCcw, ShieldCheck, Sparkles, Target, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8787/api';
const teachingStyles = {
  quick: { label: 'Quick Answer', description: 'Direct answers, no checks' },
  adaptive: { label: 'Adaptive Tutor', description: 'Checks only when useful' },
  guided: { label: 'Guided Lesson', description: 'A short check each turn' },
};
const assessmentLabels = {
  correct: 'Understanding confirmed · moving deeper',
  partial: 'Almost there · filling one gap',
  incorrect: 'Misconception spotted · rebuilding the idea',
  unclear: 'Reframing the concept',
};
const policyLabels = {
  explain: 'Building the idea',
  check: 'Checking understanding',
  diagnose: 'Finding your starting point',
  review: 'Checking long-term retention',
  clarify: 'Repairing one gap',
  revisit: 'Revisiting a prerequisite',
  advance: 'Moving one level deeper',
};
const assessmentTypeLabels = {
  diagnostic: 'Diagnostic',
  recall: 'Recall',
  application: 'Application',
  transfer: 'Transfer',
  misconception: 'Misconception check',
  delayed: 'Spaced review',
};
const strategyLabels = {
  concise: 'Concise explanation',
  example: 'Concrete example',
  analogy: 'Analogy',
  visual: 'Visual explanation',
  'worked-example': 'Worked example',
  socratic: 'Socratic question',
};
const asksForVisual = text => /\b(diag\w*|architectur\w*|flow ?chart|topology|anatomy|lifecycle|circuit schematic|map|visual|image|illustration|canvas|canavs|acnvas|interactive|slider|playground)\b/i.test(String(text));
const initialCanvasZoom = () => typeof window !== 'undefined' && window.innerWidth < 700 ? 0.57 : 0.86;
const normalizeVisual = visual => {
  if (!visual || typeof visual.thumbnailUrl !== 'string' || !visual.thumbnailUrl.startsWith('https://') || typeof visual.sourceUrl !== 'string' || !visual.sourceUrl.startsWith('https://')) return null;
  return {
    title: typeof visual.title === 'string' && visual.title.trim() ? visual.title : 'Visual reference',
    thumbnailUrl: visual.thumbnailUrl,
    sourceUrl: visual.sourceUrl,
    creator: typeof visual.creator === 'string' ? visual.creator : '',
    license: typeof visual.license === 'string' ? visual.license : '',
    description: typeof visual.description === 'string' ? visual.description : '',
  };
};
const normalizeCanvas = canvas => {
  if (!canvas || typeof canvas !== 'object' || !Array.isArray(canvas.nodes) || canvas.nodes.length < 2) return null;
  const nodes = canvas.nodes.filter(node => node && typeof node.id === 'string' && typeof node.label === 'string').slice(0, 9).map(node => ({ id: node.id, label: node.label, description: typeof node.description === 'string' ? node.description : '', kind: ['input', 'process', 'decision', 'output', 'concept'].includes(node.kind) ? node.kind : 'concept', step: Number(node.step) || 1, notation: typeof node.notation === 'string' ? node.notation : '' }));
  const ids = new Set(nodes.map(node => node.id));
  const activity = canvas.activity && typeof canvas.activity === 'object' ? {
    pattern: ['explore', 'construct', 'predict', 'diagnose', 'compare', 'sequence', 'optimize'].includes(canvas.activity.pattern) ? canvas.activity.pattern : 'explore',
    objective: typeof canvas.activity.objective === 'string' ? canvas.activity.objective : '',
    reliability: ['verified', 'source-grounded', 'conceptual'].includes(canvas.activity.reliability) ? canvas.activity.reliability : 'conceptual',
    controls: Array.isArray(canvas.activity.controls) ? canvas.activity.controls.filter(item => item && typeof item.id === 'string' && Number.isFinite(item.min) && Number.isFinite(item.max) && item.max > item.min).slice(0, 4) : [],
    metrics: Array.isArray(canvas.activity.metrics) ? canvas.activity.metrics.filter(item => item && typeof item.id === 'string' && Number.isFinite(item.baseline) && Number.isFinite(item.min) && Number.isFinite(item.max)).slice(0, 4) : [],
    challenge: typeof canvas.activity.challenge === 'string' ? canvas.activity.challenge : '',
  } : null;
  return {
    id: typeof canvas.id === 'string' ? canvas.id : crypto.randomUUID(),
    title: typeof canvas.title === 'string' ? canvas.title : 'Interactive visual',
    type: ['flowchart', 'concept-map', 'timeline', 'comparison'].includes(canvas.type) ? canvas.type : 'concept-map',
    summary: typeof canvas.summary === 'string' ? canvas.summary : '',
    domain: ['general', 'chemistry', 'mathematics', 'physics', 'computer-science', 'biology', 'history', 'finance', 'economics', 'engineering', 'medicine', 'language'].includes(canvas.domain) ? canvas.domain : 'general',
    renderer: ['knowledge-map', 'reaction-lab', 'equation-lab', 'vector-lab', 'system-lab', 'pathway-lab', 'timeline-lab'].includes(canvas.renderer) ? canvas.renderer : 'knowledge-map',
    tools: Array.isArray(canvas.tools) ? canvas.tools.filter(tool => ['predict-reveal', 'step-through', 'compare-outcomes', 'adjust-variable', 'inspect-structure', 'trace-path'].includes(tool)).slice(0, 4) : [],
    activity,
    nodes,
    edges: Array.isArray(canvas.edges) ? canvas.edges.filter(edge => edge && ids.has(edge.source) && ids.has(edge.target)).slice(0, 14) : [],
    steps: Array.isArray(canvas.steps) ? canvas.steps.filter(step => step && Array.isArray(step.nodeIds)).map(step => ({ ...step, nodeIds: step.nodeIds.filter(id => ids.has(id)) })).filter(step => step.nodeIds.length).slice(0, 8) : [],
    sourceGrounded: Boolean(canvas.sourceGrounded),
    createdAt: canvas.createdAt || null,
  };
};
const normalizeOrchestrator = value => value && typeof value === 'object' && value.nextMove && typeof value.nextMove === 'object' ? value : null;
const normalizeMessage = (message, index) => ({
  id: typeof message?.id === 'string' ? message.id : 'legacy-' + index + '-' + crypto.randomUUID(),
  role: message?.role === 'user' ? 'user' : 'assistant',
  content: typeof message?.content === 'string' ? message.content : '',
  citations: Array.isArray(message?.citations) ? message.citations.filter(citation => typeof citation === 'string') : [],
  visuals: Array.isArray(message?.visuals) ? message.visuals.map(normalizeVisual).filter(Boolean) : [],
  canvas: normalizeCanvas(message?.canvas),
  canvasAnalysis: message?.canvasAnalysis && typeof message.canvasAnalysis === 'object' ? message.canvasAnalysis : null,
  canvasChat: Array.isArray(message?.canvasChat) ? message.canvasChat.filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').slice(-30) : [],
  chemistryRuns: Array.isArray(message?.chemistryRuns) ? message.chemistryRuns.slice(-20) : [],
  visualSearchAttempted: Boolean(message?.visualSearchAttempted),
  teachingStyle: teachingStyles[message?.teachingStyle] ? message.teachingStyle : null,
  assessment: assessmentLabels[message?.assessment?.classification] ? message.assessment : null,
  conceptId: typeof message?.conceptId === 'string' ? message.conceptId : null,
  conceptLabel: typeof message?.conceptLabel === 'string' ? message.conceptLabel : null,
  policyAction: policyLabels[message?.policyAction] ? message.policyAction : null,
  policyReason: typeof message?.policyReason === 'string' ? message.policyReason : '',
  teachingStrategy: strategyLabels[message?.teachingStrategy] ? message.teachingStrategy : null,
  assessmentType: assessmentTypeLabels[message?.assessmentType] ? message.assessmentType : null,
  assessmentDifficulty: Number.isInteger(message?.assessmentDifficulty) ? message.assessmentDifficulty : null,
  orchestrator: normalizeOrchestrator(message?.orchestrator),
  status: typeof message?.status === 'string' ? message.status : 'complete',
  error: Boolean(message?.error || message?.status === 'error'),
});
const normalizeChat = chat => {
  if (!chat || typeof chat.id !== 'string' || !chat.id) return null;
  return {
    id: chat.id,
    title: typeof chat.title === 'string' && chat.title.trim() ? chat.title : 'New chat',
    pinned: Boolean(chat.pinned),
    createdAt: typeof chat.createdAt === 'string' ? chat.createdAt : new Date().toISOString(),
    updatedAt: typeof chat.updatedAt === 'string' ? chat.updatedAt : new Date().toISOString(),
    tutorState: chat.tutorState && typeof chat.tutorState === 'object' ? chat.tutorState : null,
    messages: Array.isArray(chat.messages) ? chat.messages.filter(Boolean).map(normalizeMessage) : [],
  };
};
const normalizeLearnerProfile = profile => {
  const concepts = profile?.concepts && typeof profile.concepts === 'object' ? Object.fromEntries(Object.entries(profile.concepts).filter(([, concept]) => concept && typeof concept === 'object')) : {};
  return {
    version: 3,
    learnerId: typeof profile?.learnerId === 'string' ? profile.learnerId : 'local-learner',
    concepts,
    rewardHistory: Array.isArray(profile?.rewardHistory) ? profile.rewardHistory : [],
    updatedAt: typeof profile?.updatedAt === 'string' ? profile.updatedAt : null,
  };
};

async function requestJSON(url, options) {
  const response = await fetch(url, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || 'The request failed. Please try again.');
  return data;
}

function InlineText({ text }) {
  const pieces = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return pieces.map((piece, index) => {
    if (piece.startsWith('**') && piece.endsWith('**')) return <strong key={index}>{piece.slice(2, -2)}</strong>;
    if (piece.startsWith('`') && piece.endsWith('`')) return <code key={index}>{piece.slice(1, -1)}</code>;
    return <React.Fragment key={index}>{piece}</React.Fragment>;
  });
}

function RichMessage({ content, suppressAsciiDiagrams = false }) {
  const lines = String(content).replace(/\r/g, '').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  let code = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  lines.forEach(line => {
    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      if (code) { blocks.push({ type: 'code', text: code.lines.join('\n'), language: code.language }); code = null; }
      else code = { language: line.trim().slice(3).trim(), lines: [] };
      return;
    }
    if (code) { code.lines.push(line); return; }
    if (!line.trim()) { flushParagraph(); flushList(); return; }
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    const unordered = line.match(/^[-*]\s+(.+)/);
    const ordered = line.match(/^\d+[.)]\s+(.+)/);
    const quote = line.match(/^>\s?(.+)/);
    if (heading) {
      flushParagraph(); flushList();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
    } else if (unordered || ordered) {
      flushParagraph();
      const type = ordered ? 'ordered' : 'unordered';
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((ordered || unordered)[1]);
    } else if (quote) {
      flushParagraph(); flushList();
      blocks.push({ type: 'quote', text: quote[1] });
    } else paragraph.push(line.trim());
  });
  flushParagraph();
  flushList();
  if (code) blocks.push({ type: 'code', text: code.lines.join('\n'), language: code.language });

  const visibleBlocks = suppressAsciiDiagrams ? blocks.filter(block => block.type !== 'code' || ((block.text.match(/[+|]/g) || []).length < 7 && !block.text.includes('-->'))) : blocks;
  return <div className="rich-message">{visibleBlocks.map((block, index) => {
    if (block.type === 'heading') {
      const Tag = block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4';
      return <Tag key={index}><InlineText text={block.text}/></Tag>;
    }
    if (block.type === 'ordered' || block.type === 'unordered') {
      const Tag = block.type === 'ordered' ? 'ol' : 'ul';
      return <Tag key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineText text={item}/></li>)}</Tag>;
    }
    if (block.type === 'quote') return <blockquote key={index}><InlineText text={block.text}/></blockquote>;
    if (block.type === 'code') return <div className="code-block" key={index}>{block.language && <span>{block.language}</span>}<pre><code>{block.text}</code></pre></div>;
    return <p key={index}><InlineText text={block.text}/></p>;
  })}</div>;
}

function MessageActions({ content }) {
  const [copied, setCopied] = useState(false);
  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {}
  }
  return <div className="message-actions"><button type="button" onClick={copyMessage} aria-label="Copy answer">{copied ? <Check size={14}/> : <Copy size={14}/>}<span>{copied ? 'Copied' : 'Copy'}</span></button></div>;
}

function VisualGallery({ visuals }) {
  if (!visuals?.length) return null;
  const visual = visuals[0];
  return <section className="visual-gallery" aria-label="Helpful visual references">
    <div className="visual-gallery-head"><span><ImageIcon size={14}/>Helpful visual</span></div>
    <figure className="inline-visual">
      <img src={visual.thumbnailUrl} alt={visual.title} loading="lazy"/>
      <figcaption><strong>{visual.title}</strong>{visual.description && <span>{visual.description}</span>}<a href={visual.sourceUrl} target="_blank" rel="noreferrer">{[visual.creator, visual.license].filter(Boolean).join(' · ') || 'Wikimedia Commons'}<ExternalLink size={11}/></a></figcaption>
    </figure>
  </section>;
}

function canvasLayout(canvas) {
  const nodes = canvas.nodes || [];
  const positions = {};
  if (canvas.type === 'concept-map') {
    nodes.forEach((node, index) => {
      if (index === 0) positions[node.id] = { x: 410, y: 258 };
      else {
        const angle = (Math.PI * 2 * (index - 1)) / Math.max(1, nodes.length - 1) - Math.PI / 2;
        positions[node.id] = { x: 410 + Math.cos(angle) * 310, y: 258 + Math.sin(angle) * 210 };
      }
    });
  } else if (canvas.type === 'timeline') {
    nodes.forEach((node, index) => { positions[node.id] = { x: 55 + index * (790 / Math.max(1, nodes.length - 1)), y: index % 2 ? 345 : 205 }; });
  } else if (canvas.type === 'comparison') {
    nodes.forEach((node, index) => { positions[node.id] = { x: index % 2 ? 610 : 170, y: 85 + Math.floor(index / 2) * 135 }; });
  } else {
    const groups = [...new Set(nodes.map(node => node.step))].sort((a, b) => a - b);
    groups.forEach((step, row) => {
      const rowNodes = nodes.filter(node => node.step === step);
      rowNodes.forEach((node, column) => { positions[node.id] = { x: 110 + (column + 1) * (720 / (rowNodes.length + 1)), y: 45 + row * (500 / Math.max(1, groups.length - 1)) }; });
    });
  }
  return positions;
}

function LearningFlowNode({ data }) {
  const node = data.node;
  return <div className={'flow-learning-node ' + node.kind + (data.selected ? ' selected' : '') + (data.active ? ' active' : ' dim') + (data.concealed ? ' concealed' : '')}>
    <Handle type="target" position={Position.Left}/>
    <span>{node.kind}</span>
    <strong>{data.concealed ? 'Predict the outcome' : node.label}</strong>
    {!data.concealed && node.notation && <em>{node.notation}</em>}
    <small>Step {node.step}</small>
    <Handle type="source" position={Position.Right}/>
  </div>;
}

const learningFlowNodeTypes = { learning: LearningFlowNode };

function UniversalFlowStage({ canvas, activeNodeIds, selectedId, revealed, resetToken, onSelect, onMove }) {
  const initialPositions = useMemo(() => canvasLayout(canvas), [canvas.id]);
  const buildNodes = () => canvas.nodes.map(node => ({
    id: node.id, type: 'learning', position: initialPositions[node.id] || { x: 0, y: 0 },
    data: { node, selected: selectedId === node.id, active: activeNodeIds.has(node.id), concealed: node.kind === 'output' && !revealed },
  }));
  const buildEdges = () => canvas.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label, markerEnd: { type: MarkerType.ArrowClosed }, animated: activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target), className: activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target) ? 'active' : 'dim' }));
  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges());
  const flowRef = useRef(null);
  useEffect(() => { setNodes(buildNodes()); setEdges(buildEdges()); setTimeout(() => flowRef.current?.fitView({ padding: .18, duration: 350 }), 0); }, [canvas.id]);
  useEffect(() => {
    setNodes(current => current.map(item => ({ ...item, data: { ...item.data, selected: selectedId === item.id, active: activeNodeIds.has(item.id), concealed: item.data.node.kind === 'output' && !revealed } })));
    setEdges(current => current.map(item => ({ ...item, animated: activeNodeIds.has(item.source) && activeNodeIds.has(item.target), className: activeNodeIds.has(item.source) && activeNodeIds.has(item.target) ? 'active' : 'dim' })));
  }, [selectedId, revealed, [...activeNodeIds].join('|')]);
  useEffect(() => { flowRef.current?.fitView({ padding: .18, duration: 350 }); }, [resetToken]);
  return <div className="universal-flow-stage">
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={learningFlowNodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onInit={instance => { flowRef.current = instance; instance.fitView({ padding: .18 }); }} onNodeClick={(_event, node) => onSelect(node.id)} onNodeDragStop={(_event, node) => onMove(node.id, node.position)} nodesConnectable={false} minZoom={.35} maxZoom={1.8} fitView attributionPosition="bottom-left">
      <Background gap={22} size={1}/><MiniMap zoomable pannable nodeColor={node => node.data?.selected ? '#6f8f5d' : '#a7b7ad'}/><Controls showInteractive={false}/>
    </ReactFlow>
    <div className="canvas-gradient"></div>
  </div>;
}

function UniversalActivityConsole({ canvas, onInteraction }) {
  const activity = canvas.activity;
  const defaults = useMemo(() => Object.fromEntries((activity?.controls || []).map(control => [control.id, control.default])), [canvas.id]);
  const [values, setValues] = useState(defaults);
  const [baseline, setBaseline] = useState(defaults);
  const [prediction, setPrediction] = useState('');
  const [predictionLocked, setPredictionLocked] = useState(false);
  const [interactionCount, setInteractionCount] = useState(0);
  useEffect(() => { setValues(defaults); setBaseline(defaults); setPrediction(''); setPredictionLocked(false); setInteractionCount(0); }, [canvas.id]);
  if (!activity) return null;
  function metricValue(metric, currentValues) {
    const change = (metric.effects || []).reduce((sum, effect) => {
      const control = activity.controls.find(item => item.id === effect.controlId);
      if (!control) return sum;
      return sum + ((Number(currentValues[control.id]) - control.default) / (control.max - control.min)) * effect.weight;
    }, 0);
    return Math.max(metric.min, Math.min(metric.max, metric.baseline + change));
  }
  function interact(event) { setInteractionCount(count => count + 1); onInteraction(event); }
  function changeControl(control, value) { setValues(current => ({ ...current, [control.id]: value })); interact({ type: 'activity_control', toolId: control.id, value }); }
  function reset() { setValues(defaults); setBaseline(defaults); setPrediction(''); setPredictionLocked(false); interact({ type: 'activity_reset', toolId: activity.pattern }); }
  function compare() { setBaseline(values); interact({ type: 'activity_compare', toolId: activity.pattern }); }
  function lockPrediction() { if (!prediction.trim()) return; setPredictionLocked(true); interact({ type: 'activity_prediction', toolId: activity.pattern, value: prediction.trim().length }); }
  return <section className={'universal-activity-console pattern-' + activity.pattern}>
    <header><div><span><Sparkles size={11}/>{activity.pattern} activity</span><strong>{activity.objective}</strong></div><b className={'reliability ' + activity.reliability}><ShieldCheck size={10}/>{activity.reliability.replace('-', ' ')}</b></header>
    <div className="activity-monitor"><i></i><span>Tutor observing</span><b>{interactionCount} meaningful change{interactionCount === 1 ? '' : 's'}</b></div>
    {activity.controls.length > 0 && <div className="activity-controls">{activity.controls.map(control => <label key={control.id}><span>{control.label}</span><b>{Number(values[control.id]).toFixed(control.step < 1 ? 1 : 0)}{control.unit}</b><input type="range" min={control.min} max={control.max} step={control.step} value={values[control.id]} onChange={event => changeControl(control, Number(event.target.value))}/></label>)}</div>}
    {activity.metrics.length > 0 && <div className="activity-metrics">{activity.metrics.map(metric => { const value = metricValue(metric, values); const before = metricValue(metric, baseline); const percent = ((value - metric.min) / (metric.max - metric.min)) * 100; return <article key={metric.id}><span>{metric.label}<small>{before !== value ? (value > before ? '▲' : '▼') + Math.abs(value - before).toFixed(1) : 'baseline'}</small></span><strong>{value.toFixed(Math.abs(value) < 10 ? 2 : 1)}{metric.unit}</strong><div><i style={{ width: percent + '%' }}></i></div></article>; })}</div>}
    <div className="activity-challenge"><Target size={13}/><div><span>Learning mission</span><p>{activity.challenge}</p></div></div>
    <div className="activity-prediction"><input value={prediction} disabled={predictionLocked} onChange={event => setPrediction(event.target.value)} placeholder="Predict what will happen and why…"/><button type="button" onClick={lockPrediction} disabled={!prediction.trim() || predictionLocked}>{predictionLocked ? <><Check size={11}/>Locked</> : 'Lock prediction'}</button></div>
    <footer><button type="button" onClick={reset}><RotateCcw size={11}/>Reset</button><button type="button" onClick={compare}><Pin size={11}/>Set comparison baseline</button></footer>
    {activity.reliability === 'conceptual' && <p className="activity-disclaimer">Conceptual teaching model · relationships illustrate the lesson and are not a professional simulator.</p>}
  </section>;
}

function CanvasPreview({ canvas, onOpen }) {
  if (!canvas) return null;
  return <button type="button" className="canvas-preview" onClick={onOpen}>
    <span className="canvas-preview-icon"><GitBranch size={18}/></span>
    <span><small>{canvas.domain === 'general' ? 'Interactive Visual Lab' : canvas.domain + ' · adaptive lab'}</small><strong>{canvas.title}</strong><em>{canvas.nodes.length} concepts · {canvas.steps.length} guided steps</em></span>
    <Maximize2 size={15}/>
  </button>;
}

const domainLabNames = {
  general: 'Knowledge Studio', chemistry: 'Reaction Workspace', mathematics: 'Equation Explorer', physics: 'Vector Laboratory',
  'computer-science': 'Systems Sandbox', biology: 'Pathway Explorer', history: 'Timeline Studio', finance: 'Finance Scenario Lab',
  economics: 'Market Dynamics Lab', engineering: 'Engineering Sandbox', medicine: 'Clinical Systems Lab', language: 'Language Construction Lab',
};
const labToolLabels = {
  'predict-reveal': 'Predict & reveal', 'step-through': 'Step through', 'compare-outcomes': 'Compare outcomes',
  'adjust-variable': 'Adjust variable', 'inspect-structure': 'Inspect structure', 'trace-path': 'Trace the pathway',
};

function DomainLabControls({ canvas, revealed, onReveal, variable, onVariable, compare, onCompare, onTool }) {
  const tools = canvas.tools?.length ? canvas.tools : ['step-through', 'inspect-structure'];
  return <section className={'domain-lab-card ' + canvas.domain}>
    <header><span>{canvas.domain}</span><strong>{domainLabNames[canvas.domain] || domainLabNames.general}</strong><small>Trusted renderer · {canvas.renderer.replaceAll('-', ' ')}</small></header>
    <div className="domain-tools">{tools.map(tool => <button type="button" key={tool} className={(tool === 'predict-reveal' && revealed) || (tool === 'compare-outcomes' && compare) ? 'active' : ''} onClick={() => {
      onTool(tool);
      if (tool === 'predict-reveal') onReveal();
      if (tool === 'compare-outcomes') onCompare();
    }}>{tool === 'predict-reveal' && revealed ? 'Outcome revealed' : labToolLabels[tool]}</button>)}</div>
    {tools.includes('adjust-variable') && <label className="lab-variable"><span>Explore variable</span><b>{variable}%</b><input aria-label="Learning lab variable" type="range" min="0" max="100" value={variable} onChange={event => onVariable(Number(event.target.value))}/></label>}
    {tools.includes('predict-reveal') && !revealed && <p className="prediction-note">Make a prediction before revealing the outcome. Your prediction is a learning signal—not a grade.</p>}
  </section>;
}

function MathAngleExplorer({ onInteraction }) {
  const [angle, setAngle] = useState(45);
  const radians = angle * Math.PI / 180;
  const adjacent = Math.cos(radians);
  const opposite = Math.sin(radians);
  const tangent = Math.tan(radians);
  const origin = { x: 30, y: 126 };
  const hypotenuse = 112;
  const point = { x: origin.x + adjacent * hypotenuse, y: origin.y - opposite * hypotenuse };
  function changeAngle(value) {
    const next = Math.max(10, Math.min(80, Number(value)));
    setAngle(next);
    onInteraction({ type: 'variable_change', toolId: 'triangle-angle', value: next });
  }
  return <section className="math-angle-lab">
    <header><span>Live triangle explorer</span><b>θ = {angle}°</b></header>
    <div className="triangle-viewport">
      <svg viewBox="0 0 190 150" role="img" aria-label={'Right triangle with an acute angle of ' + angle + ' degrees'}>
        <defs><linearGradient id="triangle-fill" x1="0" x2="1"><stop offset="0" stopColor="#d9e9f4"/><stop offset="1" stopColor="#e8f2e5"/></linearGradient></defs>
        <path className="triangle-shape" d={`M${origin.x},${origin.y} L${point.x},${origin.y} L${point.x},${point.y} Z`}/>
        <path className="angle-arc" d={`M${origin.x + 25},${origin.y} A25,25 0 0 0 ${origin.x + 25 * Math.cos(radians)},${origin.y - 25 * Math.sin(radians)}`}/>
        <path className="right-angle-mark" d={`M${point.x - 10},${origin.y} L${point.x - 10},${origin.y - 10} L${point.x},${origin.y - 10}`}/>
        <text x={origin.x + 28} y={origin.y - 8}>θ {angle}°</text>
        <text className="side-label" x={(origin.x + point.x) / 2} y={origin.y + 15}>adjacent · {adjacent.toFixed(2)}</text>
        <text className="side-label" x={point.x + 8} y={(origin.y + point.y) / 2}>opposite · {opposite.toFixed(2)}</text>
        <text className="side-label hyp" x={(origin.x + point.x) / 2 - 10} y={(origin.y + point.y) / 2 - 7}>hypotenuse · 1</text>
      </svg>
      <div className="trig-readout"><span><small>sin θ</small><b>{opposite.toFixed(3)}</b></span><span><small>cos θ</small><b>{adjacent.toFixed(3)}</b></span><span><small>tan θ</small><b>{tangent.toFixed(3)}</b></span></div>
    </div>
    <label><span>Change the acute angle</span><b>{angle}° + {90 - angle}° = 90°</b><input aria-label="Triangle angle" type="range" min="10" max="80" value={angle} onChange={event => changeAngle(event.target.value)}/></label>
    <div className="angle-presets">{[30, 45, 60].map(value => <button type="button" key={value} className={angle === value ? 'active' : ''} onClick={() => changeAngle(value)}>{value}°</button>)}</div>
    <p>Hypotenuse is fixed at 1. Drag the angle to see the opposite side follow <strong>sin θ</strong> and the adjacent side follow <strong>cos θ</strong>.</p>
  </section>;
}

function ChemistryPlayground({ canvas, initialResult, onRun, onInteraction }) {
  const [catalog, setCatalog] = useState(null);
  const snLesson = /sn1|sn2|substitution/i.test(canvas.title);
  const [substrateId, setSubstrateId] = useState(snLesson ? '1-bromopropane' : 'propene');
  const [reagentId, setReagentId] = useState(snLesson ? 'hydroxide' : 'hbr');
  const [conditionId, setConditionId] = useState('standard');
  const [mode, setMode] = useState('challenge');
  const [missionId, setMissionId] = useState(snLesson ? 'sn2' : 'markovnikov');
  const [predictedProductId, setPredictedProductId] = useState('');
  const [confidence, setConfidence] = useState(65);
  const [hintUsed, setHintUsed] = useState(false);
  const [mechanismStep, setMechanismStep] = useState(0);
  const [pinnedResult, setPinnedResult] = useState(initialResult?.verified ? initialResult : null);
  const [localError, setLocalError] = useState('');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    let active = true;
    requestJSON(API + '/chemistry/catalog').then(data => { if (active) setCatalog(data); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const activeMission = catalog?.missions?.find(item => item.id === missionId) || null;
  function resetOutcome() { setResult(null); setMechanismStep(0); setLocalError(''); }
  function selectMission(id) {
    const mission = catalog?.missions?.find(item => item.id === id);
    if (!mission) return;
    setMissionId(id); setSubstrateId(mission.substrateId); setReagentId(mission.reagentId); setConditionId(mission.conditionId);
    setPredictedProductId(''); setHintUsed(false); resetOutcome();
    onInteraction({ type: 'tool_use', toolId: 'mission:' + id });
  }
  async function run() {
    if (mode === 'challenge' && !predictedProductId) { setLocalError('Choose the product you predict before running the verified reaction.'); return; }
    setRunning(true);
    setLocalError('');
    try {
      const next = await onRun({ substrateId, reagentId, conditionId, predictedProductId: mode === 'challenge' ? predictedProductId : null, confidence, hintUsed });
      setResult(next); setMechanismStep(0);
      if (mode === 'challenge') onInteraction({ type: 'prediction_submit', toolId: predictedProductId, value: next.prediction?.correct ? 1 : 0 });
      onInteraction({ type: 'reaction_run', toolId: next.verified ? next.reactionClass : 'unsupported' });
    }
    catch (error) { setResult({ verified: false, error: error.message }); }
    finally { setRunning(false); }
  }
  function choose(setter, kind, value) { setter(value); setPredictedProductId(''); setHintUsed(false); resetOutcome(); onInteraction({ type: 'chemical_add', toolId: kind + ':' + value }); }
  function showHint() { setHintUsed(true); onInteraction({ type: 'hint_use', toolId: missionId || 'free-explore' }); }
  function goToMechanismStep(next) {
    const bounded = Math.max(0, Math.min((result?.mechanism?.length || 1) - 1, next));
    setMechanismStep(bounded); onInteraction({ type: 'mechanism_step', stepIndex: bounded });
  }
  function pinForComparison() { if (!result?.verified) return; setPinnedResult(result); onInteraction({ type: 'comparison_pin', toolId: result.reactionClass }); }
  if (!catalog) return <section className="chemistry-playground loading">Preparing the verified reaction library…</section>;
  const substrate = catalog.substrates.find(item => item.id === substrateId);
  const reagent = catalog.reagents.find(item => item.id === reagentId);
  return <section className="chemistry-playground">
    <header><span><FlaskConical size={12}/>Reaction Lab v2</span><b><ShieldCheck size={10}/>Verified rules · {catalog.supportedReactionCount}</b></header>
    <div className="chemistry-mode-switch" role="group" aria-label="Reaction lab mode"><button type="button" className={mode === 'challenge' ? 'active' : ''} onClick={() => { setMode('challenge'); resetOutcome(); }}>Challenge</button><button type="button" className={mode === 'explore' ? 'active' : ''} onClick={() => { setMode('explore'); resetOutcome(); }}>Free explore</button></div>
    {mode === 'challenge' && <div className="chemistry-mission"><label><span>Mission</span><select value={missionId} onChange={event => selectMission(event.target.value)}>{catalog.missions.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><p>{activeMission?.objective}</p><small>Difficulty {activeMission?.difficulty || 1}/5 · prediction counts as learning evidence</small></div>}
    <div className="reaction-equation"><div><small>Substrate</small><strong>{substrate?.formula}</strong></div><i>+</i><div><small>Reagent</small><strong>{reagent?.formula}</strong></div><i>→</i><div className={result?.verified ? 'product ready' : 'product'}><small>Product</small><strong>{result?.verified ? result.product.formula : '?'}</strong></div></div>
    <div className="chemistry-selectors"><label><span>Substrate</span><select value={substrateId} onChange={event => choose(setSubstrateId, 'substrate', event.target.value)}>{catalog.substrates.map(item => <option value={item.id} key={item.id}>{item.name} · {item.formula}</option>)}</select></label><label><span>Reagent</span><select value={reagentId} onChange={event => choose(setReagentId, 'reagent', event.target.value)}>{catalog.reagents.map(item => <option value={item.id} key={item.id}>{item.name} · {item.formula}</option>)}</select></label><label><span>Condition</span><select value={conditionId} onChange={event => choose(setConditionId, 'condition', event.target.value)}>{catalog.conditions.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div>
    {mode === 'challenge' && <div className="chemistry-prediction"><div><span><Target size={11}/>Your prediction</span><button type="button" onClick={showHint} disabled={hintUsed}><Lightbulb size={11}/>{hintUsed ? 'Hint opened' : 'Use hint'}</button></div><select aria-label="Predicted reaction product" value={predictedProductId} onChange={event => { setPredictedProductId(event.target.value); resetOutcome(); }}>{<option value="">Select the expected product…</option>}{catalog.productOptions.map(item => <option value={item.id} key={item.id}>{item.name} · {item.formula}</option>)}</select>{hintUsed && <p>{activeMission?.hint || 'Focus on substrate structure, reagent strength, and the stated conditions.'}</p>}<label><span><Gauge size={10}/>Confidence</span><b>{confidence}%</b><input type="range" min="20" max="100" step="5" value={confidence} onChange={event => setConfidence(Number(event.target.value))}/></label></div>}
    {localError && <p className="chemistry-local-error">{localError}</p>}
    <button type="button" className="run-reaction" onClick={run} disabled={running}><Play size={12}/>{running ? 'Running verified rule…' : mode === 'challenge' ? 'Lock prediction & run' : 'Run verified reaction'}</button>
    {result && <div className={'reaction-result ' + (result.verified ? 'verified' : 'unsupported')}>{result.verified ? <>
      <div className="reaction-verdict"><span>{result.prediction ? result.prediction.correct ? 'Prediction confirmed' : 'Prediction corrected' : 'Verified outcome'}</span><b>{result.prediction ? result.prediction.correct ? <><Check size={12}/>Correct</> : 'Review the mechanism' : 'Safe simulation'}</b></div>
      <h4>{result.product.name}</h4><code>{result.product.formula}</code><small>{result.reactionClass}</small>
      <div className="mechanism-player"><header><span>Mechanism player</span><small>{mechanismStep + 1}/{result.mechanism.length}</small></header><div><button type="button" onClick={() => goToMechanismStep(mechanismStep - 1)} disabled={mechanismStep === 0}><ArrowLeft size={12}/></button><p><i>{mechanismStep + 1}</i>{result.mechanism[mechanismStep]}</p><button type="button" onClick={() => goToMechanismStep(mechanismStep + 1)} disabled={mechanismStep >= result.mechanism.length - 1}><ArrowRight size={12}/></button></div><footer>{result.mechanism.map((step, index) => <button type="button" key={step} className={index === mechanismStep ? 'active' : ''} onClick={() => goToMechanismStep(index)} aria-label={'Mechanism step ' + (index + 1)}></button>)}</footer></div>
      <p>{result.explanation}</p>{result.learningEvidence && <div className="chemistry-evidence"><BrainCircuit size={13}/><span>Saved to learner evidence</span><b>{Math.round(result.learningEvidence.mastery * 100)}% concept mastery</b></div>}
      <button type="button" className="pin-comparison" onClick={pinForComparison}><Pin size={11}/>Pin this run for comparison</button>
    </> : <><span>Not simulated</span><p>{result.error}</p></>}</div>}
    {pinnedResult && <div className="reaction-comparison"><header><span>Comparison tray</span><button type="button" onClick={() => setPinnedResult(null)} aria-label="Clear comparison"><X size={11}/></button></header><div><article><small>Pinned</small><b>{pinnedResult.substrate.formula} + {pinnedResult.reagent.formula}</b><strong>{pinnedResult.product.formula}</strong><em>{pinnedResult.reactionClass}</em></article>{result?.verified && result.id !== pinnedResult.id && <article><small>Current</small><b>{result.substrate.formula} + {result.reagent.formula}</b><strong>{result.product.formula}</strong><em>{result.reactionClass}</em></article>}</div></div>}
  </section>;
}

function CanvasTutorChat({ messages, selectedNode, sending, onSend }) {
  const [value, setValue] = useState('');
  function submit(event) {
    event.preventDefault();
    const question = value.trim();
    if (!question || sending) return;
    setValue('');
    onSend(question);
  }
  return <section className="canvas-chat">
    <header><span><Sparkles size={11}/>Ask the canvas</span><small>{selectedNode ? 'Focused on ' + selectedNode.label : 'Whole visual'}</small></header>
    <div className="canvas-chat-log">{messages.length ? messages.slice(-6).map(message => <div key={message.id} className={message.role}><span>{message.role === 'user' ? 'You' : 'Tutor'}</span><p><InlineText text={message.content}/></p></div>) : <p className="canvas-chat-empty">Ask why a step happens, compare two nodes, or request a simpler explanation.</p>}{sending && <div className="assistant pending"><span>Tutor</span><p>Connecting this to the visual…</p></div>}</div>
    <form onSubmit={submit}><input value={value} onChange={event => setValue(event.target.value)} placeholder={selectedNode ? 'Ask about ' + selectedNode.label : 'Ask about this visual'} aria-label="Ask the canvas tutor"/><button type="submit" disabled={!value.trim() || sending} aria-label="Send canvas question"><ArrowUp size={14}/></button></form>
  </section>;
}

function VisualCanvas({ canvas, analysis, chatHistory = [], chemistryRuns = [], onClose, onEvents, onAsk, onChat, onChemistryRun }) {
  const [selectedId, setSelectedId] = useState(canvas.nodes[0]?.id || null);
  const [stepIndex, setStepIndex] = useState(0);
  const [resetToken, setResetToken] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [revealed, setRevealed] = useState(!canvas.tools?.includes('predict-reveal'));
  const [variable, setVariable] = useState(50);
  const [compare, setCompare] = useState(false);
  const [labChat, setLabChat] = useState(chatHistory);
  const [chatSending, setChatSending] = useState(false);
  const eventsRef = useRef([]);
  const autoAnalyzedRef = useRef(false);
  const currentStep = canvas.steps[stepIndex] || null;
  const activeNodeIds = new Set(currentStep?.nodeIds || canvas.nodes.map(node => node.id));
  const selectedNode = canvas.nodes.find(node => node.id === selectedId) || null;
  const isTriangleLab = canvas.domain === 'mathematics' && /trig|sine|cosine|right[ -]?triangle|opposite.+adjacent|adjacent.+hypotenuse/i.test([canvas.title, canvas.summary, ...canvas.nodes.map(node => node.label + ' ' + node.description)].join(' '));

  useEffect(() => {
    setSelectedId(canvas.nodes[0]?.id || null); setStepIndex(0); setResetToken(token => token + 1); setRevealed(!canvas.tools?.includes('predict-reveal')); setVariable(50); setCompare(false); setLabChat(chatHistory); setChatSending(false);
    eventsRef.current = [{ type: 'canvas_open', at: new Date().toISOString() }]; autoAnalyzedRef.current = false;
  }, [canvas.id]);

  function record(event) {
    eventsRef.current.push({ ...event, at: new Date().toISOString() });
    if (eventsRef.current.length >= 8 && !autoAnalyzedRef.current) {
      autoAnalyzedRef.current = true;
      const batch = eventsRef.current.splice(0);
      setAnalyzing(true);
      Promise.resolve(onEvents(batch, true)).finally(() => setAnalyzing(false));
    }
  }
  async function requestAnalysis() {
    const batch = eventsRef.current.splice(0);
    if (!batch.length) batch.push({ type: 'canvas_open', at: new Date().toISOString() });
    setAnalyzing(true);
    try { await onEvents(batch, true); autoAnalyzedRef.current = true; }
    finally { setAnalyzing(false); }
  }
  function close() {
    const batch = [...eventsRef.current, { type: 'canvas_close', at: new Date().toISOString() }];
    eventsRef.current = [];
    onEvents(batch, batch.length >= 4);
    onClose();
  }
  function selectNode(id) { setSelectedId(id); record({ type: 'node_select', nodeId: id, stepIndex }); }
  function changeStep(next) {
    const bounded = Math.max(0, Math.min(canvas.steps.length - 1, next));
    setStepIndex(bounded); record({ type: 'step_change', stepIndex: bounded });
    const first = canvas.steps[bounded]?.nodeIds?.[0]; if (first) setSelectedId(first);
  }
  function reset() { setResetToken(token => token + 1); record({ type: 'reset' }); }
  async function sendCanvasQuestion(question) {
    const optimistic = { id: 'local-' + crypto.randomUUID(), role: 'user', content: question };
    setLabChat(current => [...current, optimistic]); setChatSending(true);
    record({ type: 'canvas_chat', nodeId: selectedId });
    try {
      const messages = await onChat(question, selectedId);
      if (Array.isArray(messages)) setLabChat(messages);
    } catch (error) {
      setLabChat(current => [...current, { id: 'error-' + crypto.randomUUID(), role: 'assistant', content: error.message || 'The canvas tutor could not answer right now.' }]);
    } finally { setChatSending(false); }
  }

  return <div className="canvas-backdrop" onClick={close}>
    <aside className={'visual-lab domain-' + canvas.domain + (compare ? ' comparing' : '')} onClick={event => event.stopPropagation()} aria-label="Interactive Visual Lab">
      <header className="visual-lab-head"><div><span><Layers3 size={13}/>{domainLabNames[canvas.domain] || 'Visual Lab'} · {canvas.type.replace('-', ' ')}</span><h2>{canvas.title}</h2><p>{canvas.summary}</p></div><button type="button" onClick={close} aria-label="Close Visual Lab"><X size={19}/></button></header>
      <div className="visual-lab-toolbar">
        <button type="button" className="flow-reset" onClick={reset}><RotateCcw size={14}/>Fit learning map</button>
        <span className="canvas-hint"><MousePointer2 size={13}/>Drag · connect ideas · test variables</span>
        <button type="button" className="analyze-canvas" disabled={analyzing} onClick={requestAnalysis}><BrainCircuit size={14}/>{analyzing ? 'Analyzing…' : 'Analyze my exploration'}</button>
      </div>
      <div className="visual-lab-body">
        <UniversalFlowStage canvas={canvas} activeNodeIds={activeNodeIds} selectedId={selectedId} revealed={revealed} resetToken={resetToken} onSelect={selectNode} onMove={(id, position) => record({ type: 'flow_node_move', nodeId: id, value: Math.round(position.x) })}/>
        <aside className="canvas-inspector">
          {canvas.domain === 'chemistry' && <ChemistryPlayground canvas={canvas} initialResult={chemistryRuns.at(-1)} onRun={onChemistryRun} onInteraction={record}/>} 
          {isTriangleLab && <MathAngleExplorer onInteraction={record}/>} 
          {canvas.domain !== 'chemistry' && !isTriangleLab && <UniversalActivityConsole canvas={canvas} onInteraction={record}/>} 
          {!canvas.activity && !isTriangleLab && <DomainLabControls canvas={canvas} revealed={revealed} onReveal={() => { setRevealed(current => !current); record({ type: revealed ? 'prediction' : 'reveal', toolId: 'predict-reveal' }); }} variable={variable} onVariable={value => { setVariable(value); record({ type: 'variable_change', toolId: 'adjust-variable', value }); }} compare={compare} onCompare={() => setCompare(current => !current)} onTool={toolId => record({ type: 'tool_use', toolId })}/>} 
          {selectedNode && <section className="node-inspector"><span>{selectedNode.kind}</span><h3>{selectedNode.kind === 'output' && !revealed ? 'Outcome hidden' : selectedNode.label}</h3>{selectedNode.notation && !(selectedNode.kind === 'output' && !revealed) && <b className="node-notation">{selectedNode.notation}</b>}<p>{selectedNode.kind === 'output' && !revealed ? 'Use the lesson and the preceding steps to predict this outcome, then reveal it when you are ready.' : selectedNode.description}</p><button type="button" onClick={() => { record({ type: 'explain_request', nodeId: selectedNode.id }); onAsk(selectedNode); }}>Ask tutor about this <ArrowRight size={13}/></button></section>}
          {analysis && <section className="canvas-insight"><span><BrainCircuit size={12}/>Tutor observation</span><p>{analysis.recommendation}</p>{analysis.focusNodeIds?.length > 0 && <small>Suggested focus · {analysis.focusNodeIds.map(id => canvas.nodes.find(node => node.id === id)?.label).filter(Boolean).join(', ')}</small>}</section>}
          {!analysis && <section className="canvas-insight pending"><span><Sparkles size={12}/>Adaptive observation</span><p>Explore the map naturally. After a few interactions, the tutor will identify where another explanation may help.</p></section>}
          <CanvasTutorChat messages={labChat} selectedNode={selectedNode} sending={chatSending} onSend={sendCanvasQuestion}/>
        </aside>
      </div>
      <footer className="canvas-steps"><button type="button" disabled={stepIndex === 0} onClick={() => changeStep(stepIndex - 1)}><ArrowLeft size={14}/></button><div><span>Guided step {stepIndex + 1} of {Math.max(1, canvas.steps.length)}</span><strong>{currentStep?.title || 'Explore the visual'}</strong><p>{currentStep?.explanation || 'Select any concept to inspect it.'}</p><div>{canvas.steps.map((step, index) => <button type="button" key={step.id} className={index === stepIndex ? 'active' : ''} onClick={() => changeStep(index)} aria-label={'Go to step ' + (index + 1)}></button>)}</div></div><button type="button" disabled={stepIndex >= canvas.steps.length - 1} onClick={() => changeStep(stepIndex + 1)}><ArrowRight size={14}/></button></footer>
    </aside>
  </div>;
}

function studyMaterialMarkdown(material) {
  const lines = ['# ' + material.title, '', material.overview, '', '**Source:** ' + material.sourceTitle + ' · ' + material.scope, '', '**Estimated study time:** ' + material.estimatedMinutes + ' minutes', ''];
  if (material.learningObjectives?.length) lines.push('## Learning objectives', '', ...material.learningObjectives.map(item => '- ' + item), '');
  material.sections?.forEach(section => {
    lines.push('## ' + section.title + (section.sourcePage ? ' · p. ' + section.sourcePage : ''), '', section.summary, '');
    if (section.keyPoints?.length) lines.push(...section.keyPoints.map(item => '- ' + item), '');
    if (section.examples?.length) lines.push('### Examples', '', ...section.examples.map(item => '- ' + item), '');
  });
  if (material.quickReference?.length) lines.push('## Quick reference', '', ...material.quickReference.map(item => '- **' + item.term + ':** ' + item.explanation + (item.sourcePage ? ' _(p. ' + item.sourcePage + ')_' : '')), '');
  if (material.flashcards?.length) lines.push('## Flashcards', '', ...material.flashcards.map((item, index) => (index + 1) + '. **Q:** ' + item.front + '\n   **A:** ' + item.back + (item.sourcePage ? ' _(p. ' + item.sourcePage + ')_' : '')), '');
  if (material.reviewPlan?.length) lines.push('## Review plan', '', ...material.reviewPlan.map(item => '- ' + item), '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function HighlightExcerpt({ text, highlights }) {
  const terms = (Array.isArray(highlights) ? highlights : []).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!terms.length) return text;
  const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const matcher = new RegExp('(' + escaped.join('|') + ')', 'ig');
  return String(text).split(matcher).map((part, index) => terms.some(term => term.toLowerCase() === part.toLowerCase()) ? <mark key={index}>{part}</mark> : <React.Fragment key={index}>{part}</React.Fragment>);
}

function StudyMaterialStudio({ documents, savedMaterials, onCreated, onUpdated, onDeleted, onLearnerProfile, onOrchestrator, onClose, onRequestUpload }) {
  const [stage, setStage] = useState('setup');
  const [selectedId, setSelectedId] = useState(() => documents[0]?.id || '');
  const [scopeMode, setScopeMode] = useState('all');
  const [pageRange, setPageRange] = useState('');
  const [materialType, setMaterialType] = useState('study-guide');
  const [depth, setDepth] = useState('balanced');
  const [personalized, setPersonalized] = useState(true);
  const [material, setMaterial] = useState(null);
  const [resultView, setResultView] = useState('guide');
  const [flippedCard, setFlippedCard] = useState(null);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);
  const [proof, setProof] = useState(null);
  const [sectionBusy, setSectionBusy] = useState('');
  const [focusOnly, setFocusOnly] = useState(false);
  const [error, setError] = useState('');
  const selectedDocument = documents.find(document => document.id === selectedId) || documents[0] || null;
  const legacyPdf = Boolean(selectedDocument && !selectedDocument.pageCount && /\.pdf$/i.test(selectedDocument.name));
  const isPdf = Boolean(selectedDocument && (selectedDocument.pageCount || legacyPdf));
  const typeOptions = {
    'study-guide': { label: 'Study guide', description: 'Structured explanations that build understanding', icon: BookOpen },
    'revision-notes': { label: 'Revision notes', description: 'High-yield concepts, links and common traps', icon: FileText },
    'cheat-sheet': { label: 'Cheat sheet', description: 'Compact definitions, rules and quick reference', icon: ListChecks },
    flashcards: { label: 'Flashcards', description: 'Active-recall cards for efficient practice', icon: Layers3 },
  };
  function selectSource(id) { setSelectedId(id); setScopeMode('all'); setPageRange(''); setError(''); }
  function validateScope() {
    if (!selectedDocument) return 'Choose a study source.';
    if (scopeMode !== 'pages') return '';
    if (legacyPdf) return 'Re-upload ' + selectedDocument.name + ' once before selecting exact pages.';
    if (!selectedDocument.pageCount) return 'Specific pages are available only for PDF sources.';
    if (!pageRange.trim()) return 'Enter the pages to include.';
    for (const part of pageRange.split(',').map(item => item.trim()).filter(Boolean)) {
      const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      const start = Number(match?.[1]); const end = Number(match?.[2] || match?.[1]);
      if (!match || start < 1 || end < start || end > selectedDocument.pageCount) return 'Use a page range such as 12-28, 34 within pages 1–' + selectedDocument.pageCount + '.';
    }
    return '';
  }
  async function generateMaterial() {
    const scopeError = validateScope();
    if (scopeError) { setError(scopeError); return; }
    setStage('generating'); setError('');
    try {
      const data = await requestJSON(API + '/study-materials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId: selectedDocument.id, pageRange: scopeMode === 'pages' ? pageRange.trim() : '', materialType, depth, personalized }) });
      setMaterial(data.studyMaterial); setStage('result'); setResultView(materialType === 'flashcards' ? 'flashcards' : 'guide'); onCreated(data.studyMaterial);
    } catch (generationError) { setError(generationError.message); setStage('setup'); }
  }
  async function copyMaterial() {
    if (!material) return;
    try { await navigator.clipboard.writeText(studyMaterialMarkdown(material)); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch {}
  }
  function downloadMaterial() {
    if (!material) return;
    const blob = new Blob([studyMaterialMarkdown(material)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = window.document.createElement('a');
    anchor.href = url; anchor.download = material.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.md';
    anchor.style.display = 'none'; window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500); setExported(true); window.setTimeout(() => setExported(false), 1600);
  }
  function openSaved(saved) { setMaterial(saved); setStage('result'); setResultView(saved.materialType === 'flashcards' ? 'flashcards' : 'guide'); setFlippedCard(null); }
  function applyMaterialUpdate(data) {
    if (data.material) { setMaterial(data.material); onUpdated(data.material); }
    if (data.learnerProfile) onLearnerProfile(data.learnerProfile);
    if (data.orchestrator) onOrchestrator?.(normalizeOrchestrator(data.orchestrator));
  }
  async function runSectionAction(sectionIndex, action, extra = {}) {
    if (!material || sectionBusy) return;
    const busyKey = sectionIndex + ':' + action; setSectionBusy(busyKey); setError('');
    try {
      const data = await requestJSON(API + '/study-materials/' + material.id + '/sections/' + sectionIndex + '/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
      applyMaterialUpdate(data);
    } catch (actionError) { setError(actionError.message); }
    finally { setSectionBusy(''); }
  }
  async function showSourceProof(sectionIndex) {
    if (!material) return;
    setProof({ loading: true });
    try {
      const data = await requestJSON(API + '/study-materials/' + material.id + '/sections/' + sectionIndex + '/proof');
      setProof(data.proof);
    } catch (proofError) { setProof({ error: proofError.message }); }
  }
  const indexedSections = (material?.sections || []).map((section, index) => ({ section, index }));
  const weakSections = indexedSections.filter(({ section }) => section.learning?.status === 'confused' || section.learning?.microCheck?.classification === 'incorrect');
  const displayedSections = focusOnly && weakSections.length ? weakSections : indexedSections;
  const understoodCount = indexedSections.filter(({ section }) => section.learning?.status === 'understood').length;
  return <div className="material-backdrop" onClick={onClose}>
    <section className={'material-studio stage-' + stage} onClick={event => event.stopPropagation()} aria-label="Study Material Studio">
      <header className="material-studio-head"><div><span><Sparkles size={13}/>Source Focus · Material Studio</span><h2>{stage === 'result' ? material?.title : 'Create study material that fits you'}</h2><p>{stage === 'result' ? material?.sourceTitle + ' · ' + material?.scope : 'Choose a source, scope and learning format. The tutor will ground every section in your material.'}</p></div>{stage === 'result' && <div className="material-head-actions"><button type="button" onClick={copyMaterial}>{copied ? <Check size={14}/> : <Copy size={14}/>}<span>{copied ? 'Copied' : 'Copy'}</span></button><button type="button" onClick={downloadMaterial}>{exported ? <Check size={14}/> : <Download size={14}/>}<span>{exported ? 'Exported' : 'Export'}</span></button></div>}<button type="button" className="material-close" onClick={onClose} aria-label="Close Study Material Studio"><X size={19}/></button></header>
      {stage === 'setup' && <div className="material-setup">
        <main>
          <section><div className="material-section-title"><span>01</span><div><strong>Choose source and scope</strong><small>One focused source keeps every explanation traceable</small></div></div>
            <div className="quiz-source-picker"><label className="quiz-source-select"><span><BookOpen size={18}/></span><div><small>Study source</small><select aria-label="Study material source" value={selectedDocument?.id || ''} onChange={event => selectSource(event.target.value)}>{documents.map(document => <option key={document.id} value={document.id}>{document.name + (document.pageCount ? ' · ' + document.pageCount + ' pages' : ' · ' + (document.chunkCount || 0) + ' sections')}</option>)}</select></div><ChevronDown size={17}/></label>{selectedDocument && <div className="quiz-selected-source-meta"><span>{selectedDocument.pageCount ? selectedDocument.pageCount + ' pages' : (selectedDocument.chunkCount || 0) + ' sections'}</span>{selectedDocument.wordCount ? <span>{selectedDocument.wordCount.toLocaleString()} words</span> : null}</div>}</div>
            {selectedDocument && <div className="material-scope-row" role="group" aria-label="Study material scope"><button type="button" className={scopeMode === 'all' ? 'active' : ''} onClick={() => { setScopeMode('all'); setError(''); }}><Check size={12}/>Complete {isPdf ? 'PDF' : 'source'}</button><button type="button" className={scopeMode === 'pages' ? 'active' : ''} disabled={!isPdf} onClick={() => { setScopeMode('pages'); setError(''); }}><Target size={13}/>Specific pages</button></div>}
            {scopeMode === 'pages' && selectedDocument?.pageCount && <label className="material-page-range"><span><strong>Pages to include</strong><small>Available 1–{selectedDocument.pageCount}</small></span><input value={pageRange} onChange={event => { setPageRange(event.target.value); setError(''); }} placeholder="e.g. 12-28, 34" autoFocus/></label>}
            {scopeMode === 'pages' && legacyPdf && <div className="quiz-legacy-pages"><div><strong>Exact pages need a refreshed upload</strong><small>This earlier PDF has no stored page map.</small></div><button type="button" onClick={onRequestUpload}><FilePlus2 size={13}/>Re-upload PDF</button></div>}
          </section>
          <section><div className="material-section-title"><span>02</span><div><strong>Choose material format</strong><small>Generate the resource that matches today’s learning task</small></div></div><div className="material-type-grid">{Object.entries(typeOptions).map(([id, option]) => { const Icon = option.icon; return <button type="button" key={id} className={materialType === id ? 'active' : ''} onClick={() => setMaterialType(id)}><i><Icon size={17}/></i><span><strong>{option.label}</strong><small>{option.description}</small></span><b>{materialType === id ? <Check size={12}/> : null}</b></button>; })}</div></section>
          <section><div className="material-section-title"><span>03</span><div><strong>Set depth</strong><small>Control how much time and detail the material should contain</small></div></div><div className="material-depth" role="group" aria-label="Study material depth">{[['quick','Quick','10–15 min'],['balanced','Balanced','25–40 min'],['deep','Deep dive','45–90 min']].map(([id,label,time]) => <button type="button" key={id} className={depth === id ? 'active' : ''} onClick={() => setDepth(id)}><strong>{label}</strong><small>{time}</small></button>)}</div><label className="material-personalize"><span><BrainCircuit size={16}/><div><strong>Adapt to my learning profile</strong><small>Emphasize weak concepts and explain at your current level</small></div></span><input type="checkbox" checked={personalized} onChange={event => setPersonalized(event.target.checked)}/><i></i></label></section>
          {error && <div className="quiz-error">{error}</div>}
        </main>
        <aside className="material-recents"><header><span>Saved materials</span><b>{savedMaterials.length}</b></header>{savedMaterials.length ? <div>{savedMaterials.slice(0, 6).map(saved => <article key={saved.id}><button type="button" onClick={() => openSaved(saved)}><i><FileText size={14}/></i><span><strong>{saved.title}</strong><small>{typeOptions[saved.materialType]?.label || 'Study material'} · {saved.scope}</small></span><ChevronRight size={13}/></button><button type="button" className="material-delete" aria-label={'Delete ' + saved.title} onClick={() => onDeleted(saved.id)}><Trash2 size={12}/></button></article>)}</div> : <div className="material-recents-empty"><Library size={21}/><strong>Your material library starts here</strong><small>Generated resources will stay available on this device.</small></div>}</aside>
        <footer><div><span>{typeOptions[materialType].label}</span><span>{depth === 'deep' ? 'Deep dive' : depth}</span><span>{personalized ? 'Personalized' : 'Standard'}</span></div><button type="button" onClick={generateMaterial} disabled={!selectedDocument}><Sparkles size={15}/>Generate study material</button></footer>
      </div>}
      {stage === 'generating' && <div className="material-generating"><div className="quiz-orbit"><FileText size={24}/><i></i><i></i></div><span>Building {typeOptions[materialType].label.toLowerCase()}</span><strong>Mapping concepts into a useful learning resource</strong><p>Reading the selected scope, checking curriculum coverage and adapting the explanation depth.</p><div><i></i></div></div>}
      {stage === 'result' && material && <div className="material-result">
        <aside><div className="material-result-meta"><i><FileText size={18}/></i><span><small>{typeOptions[material.materialType]?.label || 'Study material'}</small><strong>{material.estimatedMinutes} min study</strong></span></div><nav><button type="button" className={resultView === 'guide' ? 'active' : ''} onClick={() => setResultView('guide')}><BookOpen size={14}/>Guide <span>{material.sections.length}</span></button><button type="button" className={resultView === 'reference' ? 'active' : ''} onClick={() => setResultView('reference')}><ListChecks size={14}/>Quick reference <span>{material.quickReference.length}</span></button><button type="button" className={resultView === 'flashcards' ? 'active' : ''} onClick={() => setResultView('flashcards')}><Layers3 size={14}/>Flashcards <span>{material.flashcards.length}</span></button></nav><div className="material-learning-pulse"><span><BrainCircuit size={11}/>Learning pulse</span><div><i style={{ width: (indexedSections.length ? understoodCount / indexedSections.length * 100 : 0) + '%' }}></i></div><small>{understoodCount} of {indexedSections.length} sections understood</small>{weakSections.length > 0 && <button type="button" className={focusOnly ? 'active' : ''} onClick={() => { setFocusOnly(value => !value); setResultView('guide'); }}><Target size={11}/>{focusOnly ? 'Show all sections' : 'Review ' + weakSections.length + ' weak section' + (weakSections.length === 1 ? '' : 's')}</button>}</div><div className="material-source-card"><span>Grounded in</span><strong>{material.sourceTitle}</strong><small>{material.scope}</small></div><button type="button" className="material-new" onClick={() => { setStage('setup'); setMaterial(null); setFocusOnly(false); }}><Plus size={13}/>Create another</button></aside>
        <main>
          {resultView === 'guide' && <article className="generated-guide"><header><span>{material.personalized ? <><BrainCircuit size={12}/>Personalized material</> : <><FileText size={12}/>Source-grounded material</>}</span><p>{material.overview}</p></header>{focusOnly && weakSections.length > 0 && <div className="material-focus-banner"><Target size={14}/><div><strong>Smart return session</strong><small>Showing the sections where confusion or an incorrect check was recorded.</small></div><button type="button" onClick={() => setFocusOnly(false)}>Show everything</button></div>}{material.learningObjectives.length > 0 && !focusOnly && <section className="material-objectives"><strong>After this, you should be able to</strong><div>{material.learningObjectives.map((objective,index) => <span key={index}><Check size={11}/>{objective}</span>)}</div></section>}<div className="material-sections">{displayedSections.map(({ section, index }) => <section key={index} className={'learning-' + (section.learning?.status || 'learning')}><header><span>{String(index + 1).padStart(2,'0')}</span><h3>{section.title}</h3>{section.learning?.status === 'understood' && <b><Check size={10}/>Understood</b>}{section.learning?.status === 'confused' && <b className="confused"><HelpCircle size={10}/>Needs work</b>}{section.sourcePage > 0 && <button type="button" className="section-page-proof" onClick={() => showSourceProof(index)}><Eye size={11}/>p. {section.sourcePage}</button>}</header><RichMessage content={section.summary}/>{section.keyPoints.length > 0 && <ul>{section.keyPoints.map((point,pointIndex) => <li key={pointIndex}><i></i><InlineText text={point}/></li>)}</ul>}{section.examples.length > 0 && <div className="material-examples"><strong>Examples & application</strong>{section.examples.map((example,exampleIndex) => <p key={exampleIndex}>{example}</p>)}</div>}{section.learning?.adaptiveExplanation && <div className="adaptive-section-explanation"><header><Sparkles size={13}/><span><strong>A different way to see it</strong><small>{section.learning.adaptiveExplanation.style}</small></span></header><p>{section.learning.adaptiveExplanation.explanation}</p>{section.learning.adaptiveExplanation.analogy && <blockquote><strong>Analogy</strong>{section.learning.adaptiveExplanation.analogy}</blockquote>}{section.learning.adaptiveExplanation.example && <div><strong>Concrete example</strong><p>{section.learning.adaptiveExplanation.example}</p></div>}</div>}{section.learning?.microCheck && <div className={'material-micro-check ' + (section.learning.microCheck.classification || '')}><header><Target size={13}/><span><strong>One-question check</strong><small>Use the idea, not just the wording</small></span></header><h4>{section.learning.microCheck.question}</h4><div>{section.learning.microCheck.options.map((option, optionIndex) => { const answered = section.learning.microCheck.classification; const correct = optionIndex === section.learning.microCheck.answerIndex; const chosen = optionIndex === section.learning.microCheck.selectedIndex; return <button type="button" key={optionIndex} disabled={Boolean(answered) || Boolean(sectionBusy)} className={(answered && correct ? 'correct ' : '') + (answered && chosen && !correct ? 'incorrect' : '')} onClick={() => runSectionAction(index, 'answer-check', { answerIndex: optionIndex })}><i>{String.fromCharCode(65 + optionIndex)}</i><span>{option}</span>{answered && correct && <Check size={12}/>}</button>; })}</div>{section.learning.microCheck.classification && <p><strong>{section.learning.microCheck.classification === 'correct' ? 'Correct.' : 'Not quite.'}</strong> {section.learning.microCheck.explanation}</p>}</div>}<div className="material-learning-actions"><button type="button" className={section.learning?.status === 'understood' ? 'active' : ''} disabled={Boolean(sectionBusy)} onClick={() => runSectionAction(index, 'understand')}><Check size={12}/>I understand</button><button type="button" className={section.learning?.status === 'confused' ? 'active confused' : ''} disabled={Boolean(sectionBusy)} onClick={() => runSectionAction(index, 'confused')}><HelpCircle size={12}/>I’m confused</button><button type="button" disabled={Boolean(sectionBusy)} onClick={() => runSectionAction(index, 'explain-differently', { style: 'analogy' })}><Lightbulb size={12}/>{sectionBusy === index + ':explain-differently' ? 'Adapting…' : 'Explain differently'}</button><button type="button" disabled={Boolean(sectionBusy)} onClick={() => runSectionAction(index, 'test-me')}><Target size={12}/>{sectionBusy === index + ':test-me' ? 'Writing check…' : 'Test me'}</button><button type="button" disabled={Boolean(sectionBusy)} onClick={() => showSourceProof(index)}><Eye size={12}/>Source proof</button></div></section>)}</div>{error && <div className="quiz-error">{error}</div>}{material.reviewPlan.length > 0 && !focusOnly && <section className="material-review-plan"><span><Clock3 size={14}/>Review plan</span>{material.reviewPlan.map((step,index) => <div key={index}><i>{index + 1}</i><p>{step}</p></div>)}</section>}</article>}
          {resultView === 'reference' && <div className="material-reference"><header><span>Quick reference</span><h3>High-signal concepts from your source</h3><p>Use this as a fast refresher before practice or assessment.</p></header><div>{material.quickReference.map((item,index) => <article key={index}><span>{String(index + 1).padStart(2,'0')}</span><div><strong>{item.term}</strong><p>{item.explanation}</p></div>{item.sourcePage > 0 && <small>p. {item.sourcePage}</small>}</article>)}</div></div>}
          {resultView === 'flashcards' && <div className="material-flashcards"><header><span>Active recall deck</span><h3>{material.flashcards.length} source-grounded cards</h3><p>Select a card to reveal the answer.</p></header><div>{material.flashcards.map((card,index) => <button type="button" key={index} className={flippedCard === index ? 'flipped' : ''} onClick={() => setFlippedCard(flippedCard === index ? null : index)}><span><small>{flippedCard === index ? 'Answer' : 'Question'} · {String(index + 1).padStart(2,'0')}</small><strong>{flippedCard === index ? card.back : card.front}</strong><i>{flippedCard === index ? 'Tap to hide' : 'Reveal answer'}{card.sourcePage > 0 ? ' · p. ' + card.sourcePage : ''}</i></span></button>)}</div></div>}
        </main>
      </div>}
      {proof && <div className="material-proof-overlay" onClick={() => setProof(null)}><aside className="material-proof-drawer" onClick={event => event.stopPropagation()}><header><div><span><Eye size={12}/>Source proof</span><h3>{proof.title || 'Finding the original passage…'}</h3>{proof.sourceTitle && <p>{proof.sourceTitle}{proof.citedPage ? ' · cited page ' + proof.citedPage : ''}</p>}</div><button type="button" onClick={() => setProof(null)} aria-label="Close source proof"><X size={17}/></button></header>{proof.loading ? <div className="proof-loading"><Sparkles size={20}/><span>Locating the strongest source evidence…</span></div> : proof.error ? <div className="proof-error">{proof.error}</div> : <div className="proof-excerpts">{proof.excerpts?.map((excerpt,index) => <article key={index}><header><span>Evidence {index + 1}</span>{excerpt.page > 0 && <b>Page {excerpt.page}</b>}</header><p><HighlightExcerpt text={excerpt.excerpt} highlights={excerpt.highlights}/></p></article>)}</div>}<footer><Check size={11}/>The explanation above is constrained to these uploaded-source passages.</footer></aside></div>}
    </section>
  </div>;
}

function QuizStudio({ documents, onLearnerProfile, onOrchestrator, onClose, onRequestUpload }) {
  const [stage, setStage] = useState('setup');
  const [difficulty, setDifficulty] = useState('medium');
  const [coverageMode, setCoverageMode] = useState('ai');
  const [count, setCount] = useState(8);
  const [selectedId, setSelectedId] = useState(() => documents[0]?.id || '');
  const [scopeMode, setScopeMode] = useState('all');
  const [pageRange, setPageRange] = useState('');
  const [quiz, setQuiz] = useState(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState(null);
  const [error, setError] = useState('');
  const difficultyCopy = {
    easy: ['Foundation', 'Direct recall and clear relationships'],
    medium: ['Application', 'Recall, comparison and interpretation'],
    hard: ['Challenge', 'Multi-step reasoning and misconceptions'],
  };
  const selectedDocument = documents.find(document => document.id === selectedId) || documents[0] || null;
  const legacyPdf = Boolean(selectedDocument && !selectedDocument.pageCount && /\.pdf$/i.test(selectedDocument.name));
  const isPdf = Boolean(selectedDocument && (selectedDocument.pageCount || legacyPdf));
  function selectSource(id) {
    setSelectedId(id);
    setScopeMode('all');
    setPageRange('');
    setError('');
  }
  async function generateQuiz() {
    if (!selectedDocument) { setError('Select a quiz source.'); return; }
    if (scopeMode === 'pages' && legacyPdf) { setError('Re-upload ' + selectedDocument.name + ' once before selecting exact pages.'); return; }
    if (scopeMode === 'pages' && selectedDocument.pageCount) {
      const value = String(pageRange || '').trim();
      if (!value) { setError('Enter the PDF pages you want to be quizzed on.'); return; }
      for (const part of value.split(',').map(item => item.trim()).filter(Boolean)) {
        const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        const start = Number(match?.[1]); const end = Number(match?.[2] || match?.[1]);
        if (!match || start < 1 || end < start || end > selectedDocument.pageCount) { setError('Check the page range. Use a format like 12-28, 34 and stay within the available pages.'); return; }
      }
    }
    setStage('generating'); setError('');
    try {
      const scopedPageRanges = scopeMode === 'pages' ? { [selectedDocument.id]: pageRange.trim() } : {};
      const data = await requestJSON(API + '/quiz', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ difficulty, coverageMode, count, documentIds: [selectedDocument.id], pageRanges: scopedPageRanges }) });
      if (!data.quiz?.questions?.length) throw new Error('No valid questions were returned.');
      setQuiz(data.quiz); setAnswers({}); setSubmission(null); setCurrent(0); setStage('quiz');
    } catch (generationError) { setError(generationError.message); setStage('setup'); }
  }
  async function submitQuiz() {
    if (!quiz || !complete || submitting) return;
    setSubmitting(true); setError('');
    try {
      const data = await requestJSON(API + '/quiz/' + quiz.id + '/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers }) });
      setSubmission(data);
      if (data.learnerProfile) onLearnerProfile?.(data.learnerProfile);
      if (data.orchestrator) onOrchestrator?.(normalizeOrchestrator(data.orchestrator));
      setStage('results');
    } catch (submitError) { setError(submitError.message); }
    finally { setSubmitting(false); }
  }
  const answeredCount = Object.keys(answers).length;
  const complete = Boolean(quiz && answeredCount === quiz.questions.length);
  const score = quiz ? quiz.questions.reduce((total, question) => total + (answers[question.id] === question.answerIndex ? 1 : 0), 0) : 0;
  const percentage = quiz ? Math.round((score / quiz.questions.length) * 100) : 0;
  const activeQuestion = quiz?.questions[current];
  return <div className="quiz-backdrop" onClick={onClose}>
    <section className={'quiz-studio stage-' + stage} onClick={event => event.stopPropagation()} aria-label="Source Focus Quiz Studio">
      <header className="quiz-studio-head"><div><span><Target size={13}/>Source Focus · Quiz Studio</span><h2>{stage === 'setup' ? 'Build a quiz from your notes' : quiz?.title || 'Preparing your quiz'}</h2><p>{stage === 'setup' ? 'Choose one source, set its scope and difficulty. Answers stay hidden until you submit.' : quiz ? quiz.sourceTitles.join(' · ') : 'Reading your selected source and composing grounded questions…'}</p></div><button type="button" onClick={onClose} aria-label="Close Quiz Studio"><X size={19}/></button></header>
      {stage === 'setup' && <div className="quiz-setup">
        <section>
          <div className="quiz-section-title"><span>01</span><div><strong>Choose quiz source</strong><small>Select one uploaded document, then define how much to include</small></div></div>
          <div className="quiz-source-picker">
            <label className="quiz-source-select">
              <span><BookOpen size={18}/></span>
              <div><small>Quiz source</small><select aria-label="Quiz source" value={selectedDocument?.id || ''} onChange={event => selectSource(event.target.value)}>{documents.map(document => <option key={document.id} value={document.id}>{document.name + (document.pageCount ? ' · ' + document.pageCount + ' pages' : ' · ' + (document.chunkCount || 0) + ' sections')}</option>)}</select></div>
              <ChevronDown size={17}/>
            </label>
            {selectedDocument && <div className="quiz-selected-source-meta"><span>{selectedDocument.pageCount ? selectedDocument.pageCount + ' pages' : (selectedDocument.chunkCount || 0) + ' readable sections'}</span>{selectedDocument.wordCount ? <span>{selectedDocument.wordCount.toLocaleString()} words</span> : null}<span>Source locked for this quiz</span></div>}
          </div>
          {selectedDocument && <div className="quiz-scope-picker">
            <div className="quiz-scope-heading"><strong>Quiz scope</strong><small>Control which part of the selected source the tutor can use</small></div>
            <div className="quiz-scope-choice" role="group" aria-label={'Quiz scope for ' + selectedDocument.name}>
              <button type="button" className={scopeMode === 'all' ? 'active' : ''} onClick={() => { setScopeMode('all'); setError(''); }}><span><BookOpen size={16}/></span><div><strong>Complete {isPdf ? 'PDF' : 'source'}</strong><small>Cover important concepts across the full document</small></div><i>{scopeMode === 'all' ? <Check size={12}/> : null}</i></button>
              <button type="button" className={scopeMode === 'pages' ? 'active' : ''} disabled={!isPdf} onClick={() => { setScopeMode('pages'); setError(''); }}><span><Target size={16}/></span><div><strong>Specific pages</strong><small>{isPdf ? 'Focus the quiz on your chosen page ranges' : 'Available for PDF sources'}</small></div><i>{scopeMode === 'pages' ? <Check size={12}/> : null}</i></button>
            </div>
            {scopeMode === 'pages' && selectedDocument.pageCount && <label className="quiz-page-range"><span><strong>Enter page range</strong><small>Available pages 1–{selectedDocument.pageCount}</small></span><input value={pageRange} onChange={event => { setPageRange(event.target.value); setError(''); }} placeholder="e.g. 12-28, 34" aria-label={'Page range for ' + selectedDocument.name} autoFocus/></label>}
            {scopeMode === 'pages' && legacyPdf && <div className="quiz-legacy-pages"><div><strong>Page numbers weren’t stored for this earlier upload</strong><small>Re-upload the PDF once to enable exact page selection. Your saved chats remain unchanged.</small></div><button type="button" onClick={onRequestUpload}><FilePlus2 size={13}/>Re-upload PDF</button></div>}
          </div>}
        </section>
        <section><div className="quiz-section-title"><span>02</span><div><strong>Choose difficulty</strong><small>This changes how the source is tested</small></div></div><div className="difficulty-grid">{Object.entries(difficultyCopy).map(([id, copy]) => <button type="button" key={id} className={difficulty === id ? 'selected' : ''} onClick={() => setDifficulty(id)}><span>{id}</span><strong>{copy[0]}</strong><small>{copy[1]}</small></button>)}</div></section>
        <section className="quiz-count-section">
          <div className="quiz-section-title"><span>03</span><div><strong>Coverage strategy</strong><small>Let the tutor protect important concepts, or set your own limit</small></div></div>
          <div className="quiz-coverage-grid">
            <button type="button" className={coverageMode === 'ai' ? 'selected' : ''} onClick={() => setCoverageMode('ai')}><span><Sparkles size={15}/><b>Recommended</b></span><strong>AI Coverage</strong><small>The tutor identifies essential concepts in your selected scope and chooses enough questions to assess them without filler.</small></button>
            <button type="button" className={coverageMode === 'custom' ? 'selected' : ''} onClick={() => setCoverageMode('custom')}><span><Target size={15}/><b>Optional</b></span><strong>Custom length</strong><small>Set a question limit. The tutor prioritizes the most important concepts when everything cannot fit.</small></button>
          </div>
          {coverageMode === 'custom' && <label className="custom-question-count"><span><strong>Question limit</strong><small>Choose between 3 and 20 questions</small></span><input type="number" min="3" max="20" value={count} onChange={event => setCount(Math.max(3, Math.min(20, Number(event.target.value) || 3)))} aria-label="Custom question limit"/><em>questions</em></label>}
        </section>
        {error && <div className="quiz-error">{error}</div>}
        <footer><div><span>{selectedDocument ? '1 selected source' : 'No source selected'}</span><span>{difficultyCopy[difficulty][0]}</span><span>{scopeMode === 'pages' ? 'Selected pages' : 'Complete source'}</span><span>{coverageMode === 'ai' ? 'AI coverage' : count + ' question limit'}</span></div><button type="button" onClick={generateQuiz} disabled={!selectedDocument}><Sparkles size={15}/>Generate grounded quiz</button></footer>
      </div>}
      {stage === 'generating' && <div className="quiz-generating"><div className="quiz-orbit"><Sparkles size={24}/><i></i><i></i></div><strong>{coverageMode === 'ai' ? 'Mapping essential concepts' : 'Designing your ' + difficulty + ' quiz'}</strong><p>{coverageMode === 'ai' ? 'The tutor is analyzing importance, building a coverage plan, and choosing the right number of grounded questions.' : 'Prioritizing the most important ideas within your question limit and grounding every answer in your notes.'}</p><div><span></span></div></div>}
      {stage === 'quiz' && activeQuestion && <div className="quiz-taking">
        <div className="quiz-progress"><span style={{ width: ((current + 1) / quiz.questions.length) * 100 + '%' }}></span></div>
        <div className="quiz-meta"><span>Question {current + 1} of {quiz.questions.length}</span><b>{quiz.difficulty} · {(quiz.coveragePlan?.filter(item => item.importance === 'essential').length || quiz.questions.length)} concepts</b><span>{answeredCount} answered</span></div>
        <main>{activeQuestion.concept && <span className="quiz-concept-label">Assessing · {activeQuestion.concept}</span>}<span className="quiz-source-label"><BookOpen size={11}/>{activeQuestion.sourceTitle}{activeQuestion.sourcePage > 0 ? ' · page ' + activeQuestion.sourcePage : ''}</span><h3>{activeQuestion.question}</h3><div className="quiz-options">{activeQuestion.options.map((option, index) => <button type="button" key={index} className={answers[activeQuestion.id] === index ? 'selected' : ''} onClick={() => setAnswers(currentAnswers => ({ ...currentAnswers, [activeQuestion.id]: index }))}><i>{String.fromCharCode(65 + index)}</i><span>{option}</span><b>{answers[activeQuestion.id] === index ? <Check size={14}/> : null}</b></button>)}</div></main>
        <footer><button type="button" disabled={current === 0 || submitting} onClick={() => setCurrent(value => value - 1)}><ArrowLeft size={14}/>Previous</button><div>{quiz.questions.map((question, index) => <button type="button" key={question.id} className={(index === current ? 'active ' : '') + (answers[question.id] !== undefined ? 'answered' : '')} onClick={() => setCurrent(index)} aria-label={'Go to question ' + (index + 1)}>{index + 1}</button>)}</div>{current < quiz.questions.length - 1 ? <button type="button" onClick={() => setCurrent(value => value + 1)}>Next<ArrowRight size={14}/></button> : <button type="button" className="submit-quiz" disabled={!complete || submitting} onClick={submitQuiz}>{submitting ? 'Updating learning model…' : 'Submit quiz'}<Check size={14}/></button>}</footer>
        {error && <div className="quiz-error">{error}</div>}
      </div>}
      {stage === 'results' && quiz && <div className="quiz-results"><section className="score-hero"><div><span>{submission?.percentage ?? percentage}%</span><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="15.9"/><circle cx="21" cy="21" r="15.9" style={{ strokeDasharray: (submission?.percentage ?? percentage) + ' ' + (100 - (submission?.percentage ?? percentage)) }}/></svg></div><strong>{percentage >= 80 ? 'Excellent source mastery' : percentage >= 60 ? 'Strong start—review a few gaps' : 'A useful first attempt'}</strong><p>You answered {submission?.score ?? score} of {quiz.questions.length} questions correctly. The adaptive tutor has updated each concept and selected your next learning move.</p>{quiz.coveragePlan?.length > 0 && <div className="quiz-coverage-audit"><span>Coverage plan · {quiz.coveragePlan.filter(item => item.importance === 'essential').length} essential concepts</span><div>{quiz.coveragePlan.filter(item => item.importance === 'essential').map((item, index) => <small key={item.concept + index}>{item.concept}</small>)}</div></div>}<button type="button" onClick={() => { setStage('setup'); setQuiz(null); setAnswers({}); setSubmission(null); }}><RotateCcw size={13}/>Build another quiz</button></section><div className="result-list">{quiz.questions.map((question, index) => { const selected = answers[question.id]; const correct = selected === question.answerIndex; return <article key={question.id} className={correct ? 'correct' : 'incorrect'}><header><span>{correct ? <Check size={12}/> : <X size={12}/>}Question {index + 1}</span><small>{question.sourceTitle}{question.sourcePage > 0 ? ' · page ' + question.sourcePage : ''}</small></header>{question.concept && <small className="result-concept">{question.concept}</small>}<h3>{question.question}</h3><div className="result-options">{question.options.map((option, optionIndex) => <div key={optionIndex} className={(optionIndex === question.answerIndex ? 'correct ' : '') + (optionIndex === selected && optionIndex !== question.answerIndex ? 'chosen-wrong' : '')}><i>{String.fromCharCode(65 + optionIndex)}</i><span>{option}</span>{optionIndex === question.answerIndex && <b>Correct answer</b>}{optionIndex === selected && optionIndex !== question.answerIndex && <b>Your answer</b>}</div>)}</div><p><strong>Why:</strong> {question.explanation}</p></article>; })}</div></div>}
    </section>
  </div>;
}

function LearningPathView({ documents, paths, generating, error, onGenerate, onContinue }) {
  const path = paths[0] || null;
  const progress = path?.progress;
  const items = progress?.items || [];
  const indexing = path?.indexing || null;
  const labelById = new Map((path?.concepts || []).map(item => [item.id, item.label]));
  if (!path) return <section className="path-empty"><div><Layers3 size={25}/></div><span>Full-source curriculum index</span><h3>Turn your notes into a learning route</h3><p>Every selected source section is analyzed in batches, audited for coverage, organized into modules, and connected to your learner model.</p>{error && <div className="path-error">{error}</div>}<button type="button" onClick={onGenerate} disabled={!documents.length || generating}><Sparkles size={14}/>{generating ? 'Scanning every source section…' : documents.length ? 'Build my learning path' : 'Upload a source first'}</button></section>;
  const recommendation = progress?.recommendation;
  return <section className="learning-path-view">
    <header className="path-overview"><div><span><Layers3 size={12}/>Active curriculum</span><h3>{path.title}</h3><p>{path.description}</p></div><div className="path-ring" style={{ '--path-progress': (progress?.completion || 0) * 3.6 + 'deg' }}><span>{progress?.completion || 0}%</span></div></header>
    {recommendation?.conceptId && <article className="next-learning-action"><span>Next best activity · {recommendation.action}</span><strong>{recommendation.label}</strong><p>{recommendation.reason}</p><button type="button" onClick={() => onContinue(recommendation.prompt)}>Continue learning <ArrowRight size={13}/></button></article>}
    {indexing && <section className="coverage-report"><header><span><Check size={12}/>Coverage audit passed</span><strong>{indexing.coveragePercent}%</strong></header><div><span><b>{indexing.analyzedChunks}</b> / {indexing.totalChunks} sections analyzed</span><span><b>{indexing.batchCount}</b> analysis batches</span><span><b>{indexing.candidateConceptCount}</b> source concepts inventoried</span><span><b>{indexing.administrativeChunks}</b> administrative sections excluded</span></div></section>}
    <div className="path-stats"><span><strong>{items.length}</strong> mapped concepts</span><span><strong>{progress?.masteredCount || 0}</strong> mastered</span><span><strong>{path.modules?.length || 1}</strong> modules</span></div>
    <div className="path-concepts">{items.map((item, index) => <React.Fragment key={item.id}>{(index === 0 || items[index - 1]?.moduleId !== item.moduleId) && <header className="path-module-head"><span>{String((path.modules || []).findIndex(module => module.id === item.moduleId) + 1 || 1).padStart(2, '0')}</span><div><strong>{item.moduleLabel || 'Core concepts'}</strong><small>{path.modules?.find(module => module.id === item.moduleId)?.summary || 'A connected group of source-grounded concepts'}</small></div></header>}<article className={'path-concept ' + item.status}><div className="path-sequence"><span>{String(index + 1).padStart(2, '0')}</span><i></i></div><div className="path-concept-body"><header><div><strong>{item.label}</strong><small>{item.status.replace('-', ' ')}{item.importance >= 5 ? ' · essential' : item.importance >= 4 ? ' · high priority' : ''}</small></div><b>{item.attempts ? Math.round(item.mastery * 100) + '%' : 'New'}</b></header><p>{item.summary}</p>{item.prerequisiteIds.length > 0 && <div className="path-prereqs"><GitBranch size={11}/>After {item.prerequisiteIds.map(id => labelById.get(id)).filter(Boolean).join(' · ')}</div>}<footer><span><BookOpen size={10}/>{item.sourceTitle}{item.sourcePage > 0 ? ' · p. ' + item.sourcePage : ''}{item.sourceReferences?.length > 1 ? ' · ' + item.sourceReferences.length + ' references' : ''}</span><div><i style={{ width: Math.round(item.mastery * 100) + '%' }}></i></div></footer></div></article></React.Fragment>)}</div>
    <button type="button" className="rebuild-path" onClick={onGenerate} disabled={generating}><RotateCcw size={12}/>{generating ? 'Scanning all sections…' : 'Rebuild complete source index'}</button>{error && <div className="path-error">{error}</div>}
  </section>;
}

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, details) {
    console.error('QuizKatalyst render recovery', error, details);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="recovery"><Sparkles size={30}/><h1>We couldn’t restore this view.</h1><p>Your saved chats are still safe. Reload the workspace to try again.</p><button onClick={() => window.location.reload()}>Reload workspace</button></div>;
  }
}

function AdaptiveLearningPulse({ orchestrator, onContinue, onFeedback }) {
  const [expanded, setExpanded] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  if (!orchestrator?.nextMove) return null;
  const move = orchestrator.nextMove;
  const active = orchestrator.activeConcept;
  const evidence = orchestrator.evidence || {};
  const state = orchestrator.learningState || {};
  const confidence = Math.round((Number(evidence.confidence) || 0) * 100);
  const momentumLabel = state.momentum === 'accelerating' ? 'Accelerating' : state.momentum === 'struggling' ? 'Needs support' : 'Steady pace';
  async function feedback(helpful) {
    if (feedbackSent) return;
    setFeedbackSent(true);
    await onFeedback?.(helpful, move.conceptId);
  }
  return <section className={'adaptive-pulse momentum-' + (state.momentum || 'steady')} aria-label="Adaptive learning orchestrator">
    <div className="pulse-orbit"><BrainCircuit size={16}/><i></i></div>
    <div className="pulse-copy"><span>Adaptive loop · {momentumLabel}</span><strong>{move.label}</strong><small>{active?.label || 'Finding your starting point'}</small></div>
    <div className="pulse-evidence" title="Confidence is based on assessed evidence, not clicks alone"><span>Evidence confidence</span><div><i style={{ width: confidence + '%' }}></i></div><b>{confidence}%</b></div>
    <button type="button" className="pulse-why" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>Why this?<ChevronDown size={13}/></button>
    <button type="button" className="pulse-continue" onClick={() => onContinue?.(move.prompt)}>{move.urgency === 'high' ? 'Start now' : 'Continue'}<ArrowRight size={13}/></button>
    {expanded && <div className="pulse-detail">
      <div><span>Decision</span><p>{move.reason}</p></div>
      <div className="pulse-ledger"><span><b>{evidence.counts?.strong || 0}</b> assessed</span><span><b>{evidence.counts?.moderate || 0}</b> guided</span><span><b>{evidence.counts?.weak || 0}</b> exploratory</span></div>
      <p className="pulse-guardrail"><ShieldCheck size={12}/>Canvas movement and self-reports guide the lesson, but only assessed answers change mastery.</p>
      <div className="pulse-feedback"><span>Was this choice useful?</span><button type="button" disabled={feedbackSent} onClick={() => feedback(true)}><Check size={11}/>Yes</button><button type="button" disabled={feedbackSent} onClick={() => feedback(false)}><RotateCcw size={11}/>Choose differently</button></div>
    </div>}
  </section>;
}

function App() {
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [input, setInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [streamingChats, setStreamingChats] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [modelOnline, setModelOnline] = useState(false);
  const [activeProvider, setActiveProvider] = useState('');
  const [providerFallback, setProviderFallback] = useState('');
  const [creatingChat, setCreatingChat] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [notice, setNotice] = useState('');
  const [learnerProfile, setLearnerProfile] = useState(() => normalizeLearnerProfile(null));
  const [learningPaths, setLearningPaths] = useState([]);
  const [generatingPath, setGeneratingPath] = useState(false);
  const [learningPathError, setLearningPathError] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [profileView, setProfileView] = useState('progress');
  const [auditingReward, setAuditingReward] = useState(null);
  const [activeCanvas, setActiveCanvas] = useState(null);
  const [showQuiz, setShowQuiz] = useState(false);
  const [showMaterials, setShowMaterials] = useState(false);
  const [studyMaterials, setStudyMaterials] = useState([]);
  const [orchestrator, setOrchestrator] = useState(null);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [tutorMode, setTutorMode] = useState(() => {
    try { return localStorage.getItem('quizkatalyst-tutor-mode') === 'source' ? 'source' : 'open'; }
    catch { return 'open'; }
  });
  const [teachingStyle, setTeachingStyle] = useState(() => {
    try {
      const saved = localStorage.getItem('quizkatalyst-teaching-style');
      return teachingStyles[saved] ? saved : 'adaptive';
    } catch { return 'adaptive'; }
  });
  const fileRef = useRef();
  const toolsMenuRef = useRef();
  const endRef = useRef();
  const chatsRef = useRef([]);
  const activeChat = chats.find(chat => chat.id === activeId) || chats[0] || null;
  const activeChatStreaming = Boolean(activeChat && streamingChats[activeChat.id]);
  const sourceMode = tutorMode === 'source';

  useEffect(() => {
    let cancelled = false;
    async function loadState() {
      try {
        const state = await requestJSON(API + '/state');
        if (cancelled) return;
        setDocuments(Array.isArray(state.documents) ? state.documents : []);
        setStudyMaterials(Array.isArray(state.studyMaterials) ? state.studyMaterials : []);
        setLearnerProfile(normalizeLearnerProfile(state.learnerProfile));
        setLearningPaths(Array.isArray(state.learningPaths) ? state.learningPaths : []);
        const savedChats = Array.isArray(state.chats) ? state.chats.map(normalizeChat).filter(Boolean) : [];
        if (savedChats.length) {
          setChats(savedChats);
          let savedActiveId = null;
          try { savedActiveId = localStorage.getItem('quizkatalyst-active-chat'); } catch {}
          setActiveId(savedChats.some(chat => chat.id === savedActiveId) ? savedActiveId : savedChats[0].id);
          recoverMissingVisuals(savedChats);
        } else {
          const data = await requestJSON(API + '/chats', { method: 'POST' });
          const chat = normalizeChat(data.chat);
          if (!chat) throw new Error('The server returned an invalid chat.');
          setChats([chat]);
          setActiveId(chat.id);
        }
      } catch (error) {
        if (!cancelled) setNotice(error.message);
      } finally {
        if (!cancelled) setInitialized(true);
      }
    }
    loadState();
    requestJSON(API + '/health').then(health => { if (!cancelled) { setModelOnline(Boolean(health.ok)); setActiveProvider(health.provider || ''); setProviderFallback(health.fallbackReason || ''); } }).catch(() => { if (!cancelled) setModelOnline(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages, activeChatStreaming]);
  useEffect(() => { chatsRef.current = chats; }, [chats]);
  useEffect(() => {
    if (!chats.length) return;
    if (!chats.some(chat => chat.id === activeId)) setActiveId(chats[0].id);
  }, [chats, activeId]);
  useEffect(() => {
    try {
      if (activeId) localStorage.setItem('quizkatalyst-active-chat', activeId);
      else localStorage.removeItem('quizkatalyst-active-chat');
    } catch {}
  }, [activeId]);
  useEffect(() => {
    try { localStorage.setItem('quizkatalyst-tutor-mode', tutorMode); } catch {}
  }, [tutorMode]);
  useEffect(() => {
    try { localStorage.setItem('quizkatalyst-teaching-style', teachingStyle); } catch {}
  }, [teachingStyle]);
  useEffect(() => {
    if (!initialized || !learnerProfile.updatedAt) return;
    requestJSON(API + '/learning-paths').then(data => setLearningPaths(Array.isArray(data.learningPaths) ? data.learningPaths : [])).catch(() => {});
  }, [initialized, learnerProfile.updatedAt]);
  useEffect(() => {
    if (!initialized) return;
    requestJSON(API + '/orchestrator' + (activeId ? '?chatId=' + encodeURIComponent(activeId) : ''))
      .then(data => setOrchestrator(normalizeOrchestrator(data.orchestrator)))
      .catch(() => {});
  }, [initialized, activeId]);
  useEffect(() => {
    if (!showProfile || profileView !== 'path') return;
    requestJSON(API + '/learning-paths').then(data => setLearningPaths(Array.isArray(data.learningPaths) ? data.learningPaths : [])).catch(error => setLearningPathError(error.message));
  }, [showProfile, profileView]);

  useEffect(() => {
    if (!showToolsMenu) return;
    function closeToolsMenu(event) {
      if (!toolsMenuRef.current?.contains(event.target)) setShowToolsMenu(false);
    }
    window.addEventListener('pointerdown', closeToolsMenu);
    return () => window.removeEventListener('pointerdown', closeToolsMenu);
  }, [showToolsMenu]);

  useEffect(() => {
    function handleWorkspaceShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (initialized && !creatingChat) newChat();
      }
      if (event.key === 'Escape') {
        if (showToolsMenu) setShowToolsMenu(false);
        else if (showMaterials) setShowMaterials(false);
        else if (showQuiz) setShowQuiz(false);
        else if (activeCanvas) setActiveCanvas(null);
        else if (showProfile) setShowProfile(false);
      }
    }
    window.addEventListener('keydown', handleWorkspaceShortcut);
    return () => window.removeEventListener('keydown', handleWorkspaceShortcut);
  }, [initialized, creatingChat, showToolsMenu, showMaterials, showQuiz, activeCanvas, showProfile]);

  async function createRemoteChat() {
    const data = await requestJSON(API + '/chats', { method: 'POST' });
    const chat = normalizeChat(data.chat);
    if (!chat) throw new Error('The server returned an invalid chat.');
    return chat;
  }

  async function recoverMissingVisuals(loadedChats) {
    const candidates = [];
    loadedChats.forEach(chat => chat.messages.forEach((message, index) => {
      const previousUserMessage = chat.messages.slice(0, index).reverse().find(item => item.role === 'user');
      if (message.role === 'assistant' && !message.visuals?.length && !message.visualSearchAttempted && asksForVisual(previousUserMessage?.content)) {
        candidates.push({ chatId: chat.id, messageId: message.id });
      }
    }));
    if (!candidates.length) return;
    const selectedCandidates = candidates.slice(-3);
    const candidateIds = new Set(selectedCandidates.map(item => item.messageId));
    setChats(current => current.map(chat => ({ ...chat, messages: chat.messages.map(message => candidateIds.has(message.id) ? { ...message, status: 'finding-visuals' } : message) })));
    await Promise.all(selectedCandidates.map(async candidate => {
      try {
        const data = await requestJSON(API + '/chats/' + candidate.chatId + '/messages/' + candidate.messageId + '/visuals', { method: 'POST' });
        const visuals = Array.isArray(data.visuals) ? data.visuals.map(normalizeVisual).filter(Boolean) : [];
        setChats(current => current.map(chat => chat.id !== candidate.chatId ? chat : { ...chat, messages: chat.messages.map(message => message.id === candidate.messageId ? { ...message, visuals, visualSearchAttempted: true, status: 'complete' } : message) }));
      } catch {
        setChats(current => current.map(chat => chat.id !== candidate.chatId ? chat : { ...chat, messages: chat.messages.map(message => message.id === candidate.messageId ? { ...message, status: 'complete' } : message) }));
      }
    }));
  }

  async function newChat() {
    if (!initialized || creatingChat) return;
    setCreatingChat(true);
    try {
      const chat = await createRemoteChat();
      setChats(current => [chat, ...current.filter(item => item.id !== chat.id)]);
      setActiveId(chat.id);
      setInput('');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setCreatingChat(false);
    }
  }

  async function updateChat(id, changes) {
    try {
      const data = await requestJSON(API + '/chats/' + id, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const updated = normalizeChat(data.chat);
      if (!updated) throw new Error('The server returned an invalid chat.');
      setChats(current => current.map(chat => chat.id === id ? {
        ...chat,
        title: updated.title,
        pinned: updated.pinned,
        updatedAt: updated.updatedAt,
      } : chat));
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function deleteChat(id) {
    try {
      await requestJSON(API + '/chats/' + id, { method: 'DELETE' });
      const remaining = chatsRef.current.filter(chat => chat.id !== id);
      if (remaining.length) {
        setChats(remaining);
        if (activeId === id) setActiveId(remaining[0].id);
      } else {
        const replacement = await createRemoteChat();
        setChats([replacement]);
        setActiveId(replacement.id);
      }
    } catch (error) { setNotice(error.message); }
  }

  function beginRename(chat) {
    setEditingId(chat.id);
    setEditTitle(chat.title);
  }

  async function finishRename(event, id) {
    event?.preventDefault();
    if (editTitle.trim()) await updateChat(id, { title: editTitle.trim() });
    setEditingId(null);
  }

  async function uploadMaterial(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    setUploading(true);
    try {
      const response = await fetch(API + '/documents', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDocuments(current => [data.document, ...current]);
    } catch (error) {
      window.alert(error.message);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  async function generateLearningPath() {
    if (!documents.length || generatingPath) return;
    setGeneratingPath(true); setLearningPathError('');
    try {
      const data = await requestJSON(API + '/learning-paths', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentIds: documents.map(document => document.id) }),
      });
      setLearningPaths(current => [data.learningPath, ...current.filter(path => path.id !== data.learningPath.id)]);
      if (data.learnerProfile) setLearnerProfile(normalizeLearnerProfile(data.learnerProfile));
    } catch (error) { setLearningPathError(error.message); }
    finally { setGeneratingPath(false); }
  }

  function continueLearningPath(prompt) {
    setShowProfile(false); setTutorMode('source'); setTeachingStyle('adaptive'); setInput(prompt);
  }

  async function auditReward(rewardId, classification) {
    if (auditingReward) return;
    setAuditingReward(rewardId);
    try {
      const data = await requestJSON(API + '/rewards/' + rewardId, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classification }),
      });
      setLearnerProfile(normalizeLearnerProfile(data.learnerProfile));
      setNotice(data.event?.auditStatus === 'corrected' ? 'The grade and learner model were corrected.' : 'The evaluator decision was confirmed.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setAuditingReward(null);
    }
  }

  async function submitCanvasEvents(canvasState, events, analyze = false) {
    if (!canvasState || !events.length) return null;
    try {
      const data = await requestJSON(API + '/chats/' + canvasState.chatId + '/messages/' + canvasState.messageId + '/canvas/interactions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events, analyze }),
      });
      if (data.analysis) {
        setChats(current => current.map(chat => chat.id !== canvasState.chatId ? chat : { ...chat, messages: chat.messages.map(message => message.id === canvasState.messageId ? { ...message, canvasAnalysis: data.analysis } : message) }));
        setActiveCanvas(current => current?.messageId === canvasState.messageId ? { ...current, analysis: data.analysis } : current);
      }
      if (analyze) requestJSON(API + '/orchestrator?chatId=' + encodeURIComponent(canvasState.chatId)).then(result => setOrchestrator(normalizeOrchestrator(result.orchestrator))).catch(() => {});
      return data.analysis || null;
    } catch (error) {
      setNotice(error.message);
      return null;
    }
  }

  async function chatWithCanvas(canvasState, message, nodeId) {
    if (!canvasState) throw new Error('Open a canvas before asking a question.');
    const data = await requestJSON(API + '/chats/' + canvasState.chatId + '/messages/' + canvasState.messageId + '/canvas/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, nodeId }),
    });
    const messages = Array.isArray(data.messages) ? data.messages : [];
    setChats(current => current.map(chat => chat.id !== canvasState.chatId ? chat : { ...chat, messages: chat.messages.map(item => item.id === canvasState.messageId ? { ...item, canvasChat: messages } : item) }));
    setActiveCanvas(current => current?.messageId === canvasState.messageId ? { ...current, chatHistory: messages } : current);
    return messages;
  }

  async function runChemistryReaction(canvasState, selection) {
    if (!canvasState) throw new Error('Open a chemistry canvas first.');
    const response = await fetch(API + '/chats/' + canvasState.chatId + '/messages/' + canvasState.messageId + '/canvas/chemistry/run', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(selection),
    });
    const data = await response.json().catch(() => ({}));
    if (!data.result) throw new Error(data.error || 'The reaction engine could not evaluate this combination.');
    const result = data.result;
    if (data.learnerProfile) setLearnerProfile(normalizeLearnerProfile(data.learnerProfile));
    setChats(current => current.map(chat => chat.id !== canvasState.chatId ? chat : { ...chat, messages: chat.messages.map(item => item.id === canvasState.messageId ? { ...item, chemistryRuns: [...(item.chemistryRuns || []), result].slice(-20) } : item) }));
    setActiveCanvas(current => current?.messageId === canvasState.messageId ? { ...current, chemistryRuns: [...(current.chemistryRuns || []), result].slice(-20) } : current);
    return result;
  }

  function askFromCanvas(node) {
    setInput('Explain the “' + node.label + '” part of the visual in a different way and connect it to the rest of the concept.');
    setActiveCanvas(null);
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const question = input.trim();
    if (!question || activeChatStreaming || !activeChat) return;
    if (sourceMode && !documents.length) {
      setNotice('Upload a PDF, text, or Markdown file to use Source Focus.');
      return;
    }
    const requestChatId = activeChat.id;
    const requestTeachingStyle = teachingStyle;
    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    setInput('');
    setStreamingChats(current => ({ ...current, [requestChatId]: true }));
    setChats(current => current.map(chat => chat.id === requestChatId ? {
      ...chat,
      messages: [
        ...chat.messages,
        { id: userMessageId, role: 'user', content: question, citations: [], visuals: [], status: 'complete', error: false },
        { id: assistantMessageId, role: 'assistant', content: '', citations: [], visuals: [], canvas: null, canvasAnalysis: null, canvasChat: [], chemistryRuns: [], visualSearchAttempted: false, teachingStyle: requestTeachingStyle, conceptId: null, conceptLabel: null, policyAction: null, policyReason: '', teachingStrategy: null, assessmentType: null, assessmentDifficulty: null, status: 'generating', error: false },
      ],
    } : chat));
    try {
      const response = await fetch(API + '/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: requestChatId, message: question, mode: tutorMode, teachingStyle: requestTeachingStyle }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = pending.split('\n');
        pending = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const streamEvent = JSON.parse(line);
          if (streamEvent.type === 'delta') {
            setChats(current => current.map(chat => chat.id !== requestChatId ? chat : {
              ...chat,
              messages: chat.messages.map(message => message.id === assistantMessageId ? { ...message, content: message.content + streamEvent.content } : message),
            }));
          }
          if (streamEvent.type === 'visual-search') {
            setChats(current => current.map(chat => chat.id !== requestChatId ? chat : {
              ...chat,
              messages: chat.messages.map(message => message.id === assistantMessageId ? { ...message, status: 'finding-visuals' } : message),
            }));
          }
          if (streamEvent.type === 'canvas-building') {
            setChats(current => current.map(chat => chat.id !== requestChatId ? chat : { ...chat, messages: chat.messages.map(message => message.id === assistantMessageId ? { ...message, status: 'building-canvas' } : message) }));
          }
          if (streamEvent.type === 'done') {
            if (streamEvent.learnerProfile) setLearnerProfile(normalizeLearnerProfile(streamEvent.learnerProfile));
            if (streamEvent.orchestrator) setOrchestrator(normalizeOrchestrator(streamEvent.orchestrator));
            const completedCanvas = normalizeCanvas(streamEvent.canvas);
            setChats(current => current.map(chat => chat.id !== requestChatId ? chat : {
              ...chat,
              title: typeof streamEvent.title === 'string' && streamEvent.title.trim() ? streamEvent.title : chat.title,
              tutorState: streamEvent.tutorState && typeof streamEvent.tutorState === 'object' ? streamEvent.tutorState : chat.tutorState,
              messages: chat.messages.map(message => message.id === assistantMessageId ? { ...message, id: typeof streamEvent.messageId === 'string' ? streamEvent.messageId : message.id, content: typeof streamEvent.content === 'string' ? streamEvent.content : message.content, citations: Array.isArray(streamEvent.citations) ? streamEvent.citations : [], visuals: Array.isArray(streamEvent.visuals) ? streamEvent.visuals.map(normalizeVisual).filter(Boolean) : [], canvas: completedCanvas, canvasAnalysis: null, canvasChat: [], chemistryRuns: [], visualSearchAttempted: Boolean(streamEvent.visualSearchAttempted), teachingStyle: teachingStyles[streamEvent.teachingStyle] ? streamEvent.teachingStyle : requestTeachingStyle, assessment: assessmentLabels[streamEvent.assessment?.classification] ? streamEvent.assessment : null, conceptId: typeof streamEvent.concept?.id === 'string' ? streamEvent.concept.id : null, conceptLabel: typeof streamEvent.concept?.label === 'string' ? streamEvent.concept.label : null, policyAction: policyLabels[streamEvent.policyAction] ? streamEvent.policyAction : null, policyReason: typeof streamEvent.policyReason === 'string' ? streamEvent.policyReason : '', teachingStrategy: strategyLabels[streamEvent.teachingStrategy] ? streamEvent.teachingStrategy : null, assessmentType: assessmentTypeLabels[streamEvent.assessmentPlan?.type] ? streamEvent.assessmentPlan.type : null, assessmentDifficulty: Number.isInteger(streamEvent.assessmentPlan?.difficulty) ? streamEvent.assessmentPlan.difficulty : null, orchestrator: normalizeOrchestrator(streamEvent.orchestrator), status: 'complete' } : message),
            }));
            if (completedCanvas) setActiveCanvas({ chatId: requestChatId, messageId: typeof streamEvent.messageId === 'string' ? streamEvent.messageId : assistantMessageId, canvas: completedCanvas, analysis: null, chatHistory: [], chemistryRuns: [] });
          }
          if (streamEvent.type === 'error') throw new Error(streamEvent.error);
        }
        if (done) break;
      }
    } catch (error) {
      setChats(current => current.map(chat => chat.id !== requestChatId ? chat : {
        ...chat,
        messages: chat.messages.map(message => message.id === assistantMessageId ? { ...message, content: error.message, status: 'error', error: true } : message),
      }));
    } finally {
      setStreamingChats(current => {
        const next = { ...current };
        delete next[requestChatId];
        return next;
      });
    }
  }

  function continueOrchestrator(prompt) {
    if (!prompt) return;
    setTeachingStyle('adaptive');
    setInput(prompt);
  }

  async function sendOrchestratorFeedback(helpful, conceptId) {
    try {
      const data = await requestJSON(API + '/orchestrator/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ helpful, conceptId }) });
      setOrchestrator(normalizeOrchestrator(data.orchestrator));
      setNotice(helpful ? 'Teaching choice recorded.' : 'The tutor will choose a different route.');
    } catch (error) { setNotice(error.message); }
  }

  const pinned = chats.filter(chat => chat.pinned);
  const recent = chats.filter(chat => !chat.pinned);
  const learnedConcepts = Object.values(learnerProfile.concepts).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const evidencedConcepts = learnedConcepts.filter(concept => concept.status !== 'unassessed');
  const masteredConcepts = learnedConcepts.filter(concept => concept.status === 'mastered').length;
  const reviewConcepts = learnedConcepts.filter(concept => concept.status === 'needs-review').length;
  const dueReviews = learnedConcepts.filter(concept => concept.nextReviewAt && new Date(concept.nextReviewAt).getTime() <= Date.now()).length;
  const averageMastery = evidencedConcepts.length ? Math.round(evidencedConcepts.reduce((sum, concept) => sum + (Number(concept.mastery) || 0), 0) / evidencedConcepts.length * 100) : 0;
  const averageConfidence = evidencedConcepts.length ? Math.round(evidencedConcepts.reduce((sum, concept) => sum + (Number(concept.confidence) || 0), 0) / evidencedConcepts.length * 100) : 0;
  const rewardEvents = [...learnerProfile.rewardHistory].reverse();
  const auditedRewards = rewardEvents.filter(event => event.auditStatus === 'confirmed' || event.auditStatus === 'corrected');
  const evaluatorAgreement = auditedRewards.length ? Math.round(auditedRewards.filter(event => event.auditStatus === 'confirmed').length / auditedRewards.length * 100) : null;

  function chatRow(chat) {
    return <div className={'chat-row ' + (activeId === chat.id ? 'selected' : '')} key={chat.id}>
      {editingId === chat.id
        ? <form className="rename" onSubmit={event => finishRename(event, chat.id)}>
            <input value={editTitle} onChange={event => setEditTitle(event.target.value)} autoFocus onBlur={event => finishRename(event, chat.id)} />
          </form>
        : <button className="chat-title" onClick={() => setActiveId(chat.id)} title={chat.title}>{chat.title}</button>}
      <div className="row-actions">
        <button title={chat.pinned ? 'Unpin chat' : 'Pin chat'} onClick={() => updateChat(chat.id, { pinned: !chat.pinned })}>{chat.pinned ? <PinOff size={15}/> : <Pin size={15}/>}</button>
        <button title="Rename chat" onClick={() => beginRename(chat)}><Pencil size={15}/></button>
        <button title="Delete chat" onClick={() => deleteChat(chat.id)}><Trash2 size={15}/></button>
      </div>
    </div>;
  }

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span>K</span><div><strong>QuizKatalyst</strong><small>Adaptive learning OS</small></div></div>
      <button className="new-chat" onClick={newChat} disabled={!initialized || creatingChat}><Plus size={18}/> {creatingChat ? 'Creating…' : 'New chat'} <kbd>⌘ K</kbd></button>
      <div className="history">
        {pinned.length > 0 && <section><label>Pinned</label>{pinned.map(chatRow)}</section>}
        <section><label>Recent</label>{recent.map(chatRow)}</section>
      </div>
      <div className="sidebar-footer">
        <button className="library profile-trigger" onClick={() => setShowProfile(true)}><BrainCircuit size={19}/><div><strong>Learning profile</strong><small>{learnedConcepts.length ? averageMastery + '% across ' + learnedConcepts.length + ' concept' + (learnedConcepts.length > 1 ? 's' : '') : 'Builds as you learn'}</small></div><ChevronRight size={16}/></button>
        <button className="library" onClick={() => fileRef.current.click()}><Library size={19}/><div><strong>Study library</strong><small>{documents.length ? documents.length + ' source' + (documents.length > 1 ? 's' : '') : 'Add your first source'}</small></div><ChevronRight size={16}/></button>
        <div className="account"><span>AR</span><div><strong>Ajith Reddy</strong><small className={modelOnline ? 'online' : 'offline'} title={providerFallback}>{modelOnline ? '● ' + (activeProvider === 'groq' ? 'Groq Cloud ready' : 'Ollama fallback ready') : '● AI provider offline'}</small></div><button aria-label="Account menu"><MoreHorizontal size={18}/></button></div>
      </div>
      <input ref={fileRef} type="file" accept=".pdf,.txt,.md" hidden onChange={uploadMaterial} />
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div className="chat-heading"><h1>{activeChat?.title || 'New chat'}</h1><span>{sourceMode ? (documents.length ? 'Grounded in ' + documents.length + ' source' + (documents.length > 1 ? 's' : '') : 'Upload required for this mode') : 'General knowledge with ' + (activeProvider === 'groq' ? 'Groq Cloud' : 'your private Ollama fallback')}</span></div>
        <div className="mode-switch" role="group" aria-label="Tutor mode">
          <button type="button" className={sourceMode ? 'active' : ''} aria-pressed={sourceMode} onClick={() => { setTutorMode('source'); setShowToolsMenu(false); setNotice(''); }} title="Answers use only your uploaded documents"><BookOpen size={15}/><span><strong>Source Focus</strong><small>Your material only</small></span></button>
          <button type="button" className={!sourceMode ? 'active' : ''} aria-pressed={!sourceMode} onClick={() => { setTutorMode('open'); setShowToolsMenu(false); setNotice(''); }} title="Ask general questions without uploading a document"><Globe2 size={15}/><span><strong>Open Tutor</strong><small>General knowledge</small></span></button>
        </div>
        <div className="top-actions">
          <button className="mobile-new-chat" onClick={newChat} disabled={!initialized || creatingChat} aria-label="New chat"><Plus size={17}/></button>
          {sourceMode && <button className="command-primary" onClick={() => setShowQuiz(true)} disabled={!documents.length} aria-label="Open Source Focus Quiz Studio"><Target size={15}/><span>Quiz</span></button>}
          <div className="tools-menu-shell" ref={toolsMenuRef}>
            <button type="button" className={'tools-trigger ' + (showToolsMenu ? 'open' : '')} aria-expanded={showToolsMenu} aria-haspopup="menu" onClick={() => setShowToolsMenu(value => !value)}><Sparkles size={15}/><span>{sourceMode ? 'Study tools' : 'Workspace'}</span><MoreHorizontal size={15}/>{dueReviews > 0 && <i className="action-badge">{dueReviews}</i>}</button>
            {showToolsMenu && <div className="tools-popover" role="menu">
              <header><span><Sparkles size={13}/>{sourceMode ? 'Study command center' : 'Tutor workspace'}</span><small>{sourceMode ? 'Your learning tools, organized' : 'Tools for this learning session'}</small></header>
              <div>
                {sourceMode && <button type="button" role="menuitem" onClick={() => { setShowToolsMenu(false); setShowMaterials(true); }} disabled={!documents.length}><i><FileText size={17}/></i><span><strong>Material Studio</strong><small>Guides, notes and flashcards</small></span><ChevronRight size={14}/></button>}
                {sourceMode && <button type="button" role="menuitem" onClick={() => { setShowToolsMenu(false); setProfileView('path'); setShowProfile(true); }} disabled={!documents.length}><i><Layers3 size={17}/></i><span><strong>Learning path</strong><small>Continue your curriculum</small></span><ChevronRight size={14}/></button>}
                <button type="button" role="menuitem" onClick={() => { setShowToolsMenu(false); setProfileView('progress'); setShowProfile(true); }}><i><BrainCircuit size={17}/></i><span><strong>Progress</strong><small>{dueReviews > 0 ? dueReviews + ' reviews ready' : 'Mastery and evidence'}</small></span><ChevronRight size={14}/></button>
                <button type="button" role="menuitem" onClick={() => { setShowToolsMenu(false); fileRef.current.click(); }}><i><FilePlus2 size={17}/></i><span><strong>Add sources</strong><small>PDF, text or Markdown</small></span><ChevronRight size={14}/></button>
                {sourceMode && <button type="button" role="menuitem" onClick={() => { setShowToolsMenu(false); setShowQuiz(true); }} disabled={!documents.length}><i><Target size={17}/></i><span><strong>Quiz Studio</strong><small>Coverage-first assessment</small></span><ChevronRight size={14}/></button>}
              </div>
              <footer><span className={modelOnline ? 'online' : ''}></span>{modelOnline ? (activeProvider === 'groq' ? 'Groq Cloud connected' : 'Local model connected') : 'AI provider unavailable'}</footer>
            </div>}
          </div>
        </div>
      </header>

      <AdaptiveLearningPulse orchestrator={orchestrator} onContinue={continueOrchestrator} onFeedback={sendOrchestratorFeedback}/>

      {showProfile && <div className="profile-backdrop" onClick={() => setShowProfile(false)}>
        <aside className="profile-panel" aria-label="Learning profile" onClick={event => event.stopPropagation()}>
          <header><div><span className="profile-eyebrow"><BrainCircuit size={13}/>Local learner model</span><h2>Your understanding</h2><p>QuizKatalyst stores this evidence on this device and uses it to choose what to teach next.</p></div><button type="button" onClick={() => setShowProfile(false)} aria-label="Close learning profile"><X size={18}/></button></header>
          <nav className="profile-tabs" aria-label="Learning profile views"><button type="button" className={profileView === 'path' ? 'active' : ''} onClick={() => setProfileView('path')}>Learning path</button><button type="button" className={profileView === 'progress' ? 'active' : ''} onClick={() => setProfileView('progress')}>Progress</button><button type="button" className={profileView === 'rewards' ? 'active' : ''} onClick={() => setProfileView('rewards')}>Rewards <span>{rewardEvents.filter(event => event.auditStatus === 'unreviewed').length}</span></button></nav>
          {profileView === 'path' && <LearningPathView documents={documents} paths={learningPaths} generating={generatingPath} error={learningPathError} onGenerate={generateLearningPath} onContinue={continueLearningPath}/>} 
          {profileView === 'progress' && <><section className="profile-summary">
            <div><strong>{averageMastery}%</strong><span>Average mastery</span></div>
            <div><strong>{averageConfidence}%</strong><span>Evidence confidence</span></div>
            <div><strong>{dueReviews}</strong><span>Reviews due</span></div>
          </section>
          <div className="profile-legend"><span><i></i>Mastery estimates performance</span><span><i></i>Confidence measures evidence quality</span></div>
          <div className="concept-list">
            {!learnedConcepts.length ? <div className="profile-empty"><Target size={25}/><strong>No concepts yet</strong><p>Start learning in Adaptive Tutor mode. Concepts and evidence will appear here after the tutor checks your understanding.</p></div> : learnedConcepts.map(concept => {
              const mastery = Math.round((Number(concept.mastery) || 0) * 100);
              const confidence = Math.round((Number(concept.confidence) || 0) * 100);
              const misconceptionCount = Array.isArray(concept.misconceptions) ? concept.misconceptions.length : 0;
              const prerequisites = Array.isArray(concept.prerequisites) ? concept.prerequisites.map(id => learnerProfile.concepts[id]?.label).filter(Boolean) : [];
              const bestStrategy = Object.entries(concept.strategyStats || {}).filter(([, stats]) => (stats?.uses || 0) > 0).sort(([, a], [, b]) => ((b.reward || 0) / b.uses) - ((a.reward || 0) / a.uses))[0]?.[0];
              return <article className="concept-card" key={concept.id}>
                <div className="concept-head"><div><strong>{concept.label}</strong><span className={'concept-status ' + concept.status}>{String(concept.status || 'unassessed').replace('-', ' ')}</span></div><b>{concept.status === 'unassessed' ? '—' : mastery + '%'}</b></div>
                <div className="mastery-track"><span style={{ width: mastery + '%' }}></span></div>
                <div className="confidence-row"><span>Evidence confidence</span><b>{confidence}%</b></div>
                <div className="confidence-track"><span style={{ width: confidence + '%' }}></span></div>
                <div className="concept-meta"><span>{concept.attempts || 0} assessed response{concept.attempts === 1 ? '' : 's'}</span><span>Difficulty {concept.difficultyLevel || 1}/5</span></div>
                {prerequisites.length > 0 && <div className="concept-detail"><GitBranch size={12}/><span>Builds on {prerequisites.join(' · ')}</span></div>}
                {bestStrategy && <div className="concept-detail"><Sparkles size={12}/><span>Working well: {strategyLabels[bestStrategy]}</span></div>}
                {misconceptionCount > 0 && <div className="misconception-note"><span>Watch for</span><p>{concept.misconceptions[0].text}</p></div>}
                {concept.nextReviewAt && <small className={'review-date ' + (new Date(concept.nextReviewAt).getTime() <= Date.now() ? 'due' : '')}><Clock3 size={11}/>{new Date(concept.nextReviewAt).getTime() <= Date.now() ? 'Review due now' : 'Suggested review · ' + new Date(concept.nextReviewAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>}
                {concept.nextReviewAt && new Date(concept.nextReviewAt).getTime() <= Date.now() && <button type="button" className="review-now" onClick={() => { setShowProfile(false); setTeachingStyle('adaptive'); setInput('Review me on ' + concept.label); }}>Start review <ChevronRight size={13}/></button>}
              </article>;
            })}
          </div></>}
          {profileView === 'rewards' && <section className="reward-audit">
            <div className="audit-summary"><div><strong>{rewardEvents.length}</strong><span>Evidence events</span></div><div><strong>{auditedRewards.length}</strong><span>Reviewed</span></div><div><strong>{evaluatorAgreement === null ? '—' : evaluatorAgreement + '%'}</strong><span>Agreement</span></div></div>
            <p className="audit-explainer">Rewards tune the teaching policy, not the language model’s weights. Confirming or correcting a grade updates mastery and strategy outcomes immediately.</p>
            {!rewardEvents.length ? <div className="profile-empty"><Check size={25}/><strong>No rewards yet</strong><p>Reward evidence appears after you answer a diagnostic or learning check.</p></div> : <div className="reward-list">{rewardEvents.map(event => {
              const currentClassification = event.classification || 'unclear';
              const confidence = typeof event.evaluatorConfidence === 'number' ? Math.round(event.evaluatorConfidence * 100) : null;
              return <article className={'reward-card ' + (event.auditStatus || 'unreviewed')} key={event.id}>
                <div className="reward-head"><div><strong>{event.conceptLabel || learnerProfile.concepts[event.conceptId]?.label || 'Learning evidence'}</strong><span>{assessmentTypeLabels[event.assessmentType] || event.assessmentType || 'Assessment'} · level {event.difficulty || 1}</span></div><b className={(Number(event.reward) || 0) >= 0 ? 'positive' : 'negative'}>{(Number(event.reward) || 0) > 0 ? '+' : ''}{Number(event.reward || 0).toFixed(3)}</b></div>
                <div className="reward-facts"><span className={'grade ' + currentClassification}>{currentClassification}</span><span>{strategyLabels[event.strategy] || event.strategy}</span>{confidence !== null && <span>{confidence}% evaluator confidence</span>}</div>
                {event.misconception && <p className="reward-misconception">{event.misconception}</p>}
                <div className="reward-impact"><span>Mastery impact</span><b>{(Number(event.masteryDelta) || 0) >= 0 ? '+' : ''}{Math.round((Number(event.masteryDelta) || 0) * 1000) / 10}%</b></div>
                <div className="audit-actions" aria-label="Correct evaluator grade"><span>Was this grade right?</span>{['correct', 'partial', 'incorrect'].map(classification => <button type="button" key={classification} disabled={auditingReward === event.id} className={currentClassification === classification ? 'selected' : ''} onClick={() => auditReward(event.id, classification)}>{classification === currentClassification ? 'Confirm ' : 'Mark '}{classification}</button>)}</div>
                {event.auditStatus !== 'unreviewed' && <small className="audit-status"><Check size={11}/>{event.auditStatus === 'corrected' ? 'Corrected by learner' : 'Confirmed by learner'}</small>}
              </article>;
            })}</div>}
          </section>}
        </aside>
      </div>}

      {activeCanvas && <VisualCanvas canvas={activeCanvas.canvas} analysis={activeCanvas.analysis} chatHistory={activeCanvas.chatHistory} chemistryRuns={activeCanvas.chemistryRuns} onClose={() => setActiveCanvas(null)} onEvents={(events, analyze) => submitCanvasEvents(activeCanvas, events, analyze)} onAsk={askFromCanvas} onChat={(message, nodeId) => chatWithCanvas(activeCanvas, message, nodeId)} onChemistryRun={selection => runChemistryReaction(activeCanvas, selection)}/>} 
      {showMaterials && <StudyMaterialStudio documents={documents} savedMaterials={studyMaterials} onCreated={created => setStudyMaterials(current => [created, ...current.filter(item => item.id !== created.id)])} onUpdated={updated => setStudyMaterials(current => current.map(item => item.id === updated.id ? updated : item))} onLearnerProfile={profile => setLearnerProfile(normalizeLearnerProfile(profile))} onOrchestrator={setOrchestrator} onDeleted={async id => { try { await requestJSON(API + '/study-materials/' + id, { method: 'DELETE' }); setStudyMaterials(current => current.filter(item => item.id !== id)); } catch (deleteError) { setNotice(deleteError.message); } }} onClose={() => setShowMaterials(false)} onRequestUpload={() => { setShowMaterials(false); window.setTimeout(() => fileRef.current?.click(), 0); }}/>} 
      {showQuiz && <QuizStudio documents={documents} onLearnerProfile={profile => setLearnerProfile(normalizeLearnerProfile(profile))} onOrchestrator={setOrchestrator} onClose={() => setShowQuiz(false)} onRequestUpload={() => { setShowQuiz(false); window.setTimeout(() => fileRef.current?.click(), 0); }}/>} 

      <section className={'conversation ' + (!activeChat?.messages.length ? 'empty' : '')}>
        {!activeChat?.messages.length ? <div className="welcome">
          <div className="mark"><Sparkles size={22}/></div>
          <h2>What would you like to understand?</h2>
          <p>{sourceMode ? 'Upload your study material and I’ll explain only what it contains, with clear source grounding.' : 'Ask about any subject. I’ll adapt the explanation, check your reasoning, and follow your pace.'}</p>
          <div className="starter-grid">
            <button onClick={() => fileRef.current.click()}><BookOpen size={21}/><strong>Add study material</strong><small>PDF, text, or Markdown</small></button>
            <button onClick={() => { setTeachingStyle('guided'); setInput(sourceMode ? 'Help me understand the key ideas in my material' : 'Teach me a topic step by step and check my understanding'); }}><GraduationCap size={22}/><strong>Start a guided lesson</strong><small>Learn in small steps with checks</small></button>
          </div>
        </div> : <div className="messages">
          {activeChat.messages.map(message => <article className={message.role + (message.error ? ' error' : '')} key={message.id}>
            <div className="avatar">{message.role === 'user' ? 'AR' : 'K'}</div>
            <div className="bubble">
              <div className="message-head"><div className="message-name">{message.role === 'user' ? 'You' : <><Sparkles size={13}/> QuizKatalyst</>}</div>{message.role === 'assistant' && <span className="answer-mode" title={message.policyReason || ''}>{message.policyAction ? policyLabels[message.policyAction] : message.teachingStyle ? teachingStyles[message.teachingStyle].label : 'Tutor response'}</span>}</div>
              {message.role === 'assistant' && message.assessment && <div className={'learning-signal ' + message.assessment.classification}><span></span>{assessmentLabels[message.assessment.classification]}</div>}
              {message.role === 'assistant' && (message.assessmentType || message.teachingStrategy) && <div className="teaching-evidence">{message.assessmentType && <span>{assessmentTypeLabels[message.assessmentType]}{message.assessmentDifficulty ? ' · level ' + message.assessmentDifficulty : ''}</span>}{message.teachingStrategy && <span>{strategyLabels[message.teachingStrategy]}</span>}</div>}
              {message.role === 'assistant' && <VisualGallery visuals={message.visuals}/>} 
              {message.role === 'assistant' && <CanvasPreview canvas={message.canvas} onOpen={() => setActiveCanvas({ chatId: activeChat.id, messageId: message.id, canvas: message.canvas, analysis: message.canvasAnalysis, chatHistory: message.canvasChat || [], chemistryRuns: message.chemistryRuns || [] })}/>} 
              {message.content ? (message.role === 'assistant' ? <RichMessage content={message.content} suppressAsciiDiagrams={message.visuals?.length > 0}/> : <p className="user-copy">{message.content}</p>) : <div className="thinking"><i></i><i></i><i></i><span>Thinking</span></div>}
              {message.status === 'finding-visuals' && <div className="visual-searching"><ImageIcon size={14}/><span>Finding a helpful visual</span><i></i></div>}
              {message.status === 'building-canvas' && <div className="visual-searching canvas-building"><GitBranch size={14}/><span>Building an interactive Visual Lab</span><i></i></div>}
              {message.citations?.length > 0 && <div className="citations"><BookOpen size={13}/><span>Sources</span>{message.citations.map(citation => <b key={citation}>{citation}</b>)}</div>}
              {message.role === 'assistant' && message.content && message.status !== 'generating' && <MessageActions content={message.content}/>} 
            </div>
          </article>)}
          <div ref={endRef} />
        </div>}
      </section>

      <div className="composer-wrap">
        <form className="composer" onSubmit={sendMessage}>
          <div className="teaching-style-switch" role="group" aria-label="Teaching style">
            {Object.entries(teachingStyles).map(([key, style]) => <button key={key} type="button" className={teachingStyle === key ? 'active' : ''} aria-pressed={teachingStyle === key} disabled={activeChatStreaming} onClick={() => setTeachingStyle(key)} title={style.description}><strong>{style.label}</strong><small>{style.description}</small></button>)}
          </div>
          <div className="composer-quick-actions" aria-label="Quick learning prompts">
            {(sourceMode
              ? ['Summarize the key ideas', 'Explain with a visual', 'Quiz me on weak areas']
              : ['Explain this simply', 'Show a real-world example', 'Quiz me on this topic'])
              .map((prompt, index) => <button type="button" key={prompt} disabled={activeChatStreaming || (sourceMode && !documents.length)} onClick={() => setInput(prompt)}><span>{index === 0 ? '⌁' : index === 1 ? '◇' : '◎'}</span>{prompt}</button>)}
          </div>
          <textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder={sourceMode ? (documents.length ? 'Ask anything about your material…' : 'Upload a source to begin…') : 'Ask me anything…'} disabled={activeChatStreaming} rows="1" />
          <div className="composer-bottom"><button type="button" className="attach" onClick={() => fileRef.current.click()} disabled={uploading} aria-label="Attach study material"><Paperclip size={17}/></button><span>{uploading ? 'Adding source…' : sourceMode ? (documents.length ? 'Source Focus · grounded answers' : 'Source Focus · upload required') : 'Open Tutor · no source required'}</span><button className="send" disabled={activeChatStreaming || !input.trim() || (sourceMode && !documents.length)} aria-label="Send message"><ArrowUp size={18}/></button></div>
        </form>
        <small className="disclaimer">{sourceMode ? 'Answers are limited to your uploaded sources.' : 'Open Tutor can make mistakes. Check important information.'}</small>
      </div>
      {notice && <button className="toast" onClick={() => setNotice('')}>{notice}<span>×</span></button>}
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<AppErrorBoundary><App /></AppErrorBoundary>);
