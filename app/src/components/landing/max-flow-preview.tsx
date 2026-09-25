import { useEffect, useState } from 'react'

const FLOW_NODES = {
  s: [40, 120],
  a: [150, 56],
  b: [150, 184],
  c: [270, 56],
  d: [270, 184],
  t: [380, 120],
} as const

type FlowNode = keyof typeof FLOW_NODES

const FLOW_NODE_RADIUS = 14
const FLOW_ARROW = 8

const FLOW_EDGES = [
  { id: 'sa', from: 's', to: 'a', cap: 10, label: [78, 76] },
  { id: 'sb', from: 's', to: 'b', cap: 8, label: [78, 176] },
  { id: 'ac', from: 'a', to: 'c', cap: 6, label: [194, 46] },
  { id: 'ad', from: 'a', to: 'd', cap: 5, label: [192, 132] },
  { id: 'bd', from: 'b', to: 'd', cap: 9, label: [210, 206] },
  { id: 'ct', from: 'c', to: 't', cap: 8, label: [344, 74] },
  { id: 'dt', from: 'd', to: 't', cap: 10, label: [344, 182] },
] as const satisfies ReadonlyArray<{
  id: string
  from: FlowNode
  to: FlowNode
  cap: number
  label: readonly [number, number]
}>

type FlowEdgeId = (typeof FLOW_EDGES)[number]['id']

const FLOW_STEPS: ReadonlyArray<{
  path: ReadonlyArray<FlowEdgeId>
  gain: number
  caption: string
}> = [
  { path: [], gain: 0, caption: 'Start with zero flow on every edge.' },
  {
    path: ['sa', 'ac', 'ct'],
    gain: 6,
    caption: 'Augment along s → A → C → t. Bottleneck: 6.',
  },
  {
    path: ['sa', 'ad', 'dt'],
    gain: 4,
    caption: 'Augment along s → A → D → t. Bottleneck: 4.',
  },
  {
    path: ['sb', 'bd', 'dt'],
    gain: 6,
    caption: 'Augment along s → B → D → t. Bottleneck: 6.',
  },
  {
    path: [],
    gain: 0,
    caption: 'No augmenting path is left. Max flow 16 equals the min cut.',
  },
]

const FLOW_LAST_STEP = FLOW_STEPS.length - 1
const FLOW_STEP_MS = 2400

const FLOW_GEOMETRY = FLOW_EDGES.map((edge) => {
  const [x1, y1] = FLOW_NODES[edge.from]
  const [x2, y2] = FLOW_NODES[edge.to]
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  const ux = dx / len
  const uy = dy / len
  const tail = FLOW_NODE_RADIUS + FLOW_ARROW
  return {
    ...edge,
    x1: x1 + ux * FLOW_NODE_RADIUS,
    y1: y1 + uy * FLOW_NODE_RADIUS,
    x2: x2 - ux * tail,
    y2: y2 - uy * tail,
  }
})

function flowOn(edge: FlowEdgeId, step: number) {
  let total = 0
  for (let i = 0; i <= step; i++) {
    const s = FLOW_STEPS[i]
    if (s.path.includes(edge)) total += s.gain
  }
  return total
}

export function MaxFlowPreview() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(FLOW_LAST_STEP)
      return
    }
    const id = window.setInterval(
      () => setStep((s) => (s === FLOW_LAST_STEP ? 0 : s + 1)),
      FLOW_STEP_MS,
    )
    return () => window.clearInterval(id)
  }, [])

  const current = FLOW_STEPS[step]
  const showCut = step === FLOW_LAST_STEP
  const total = flowOn('sa', step) + flowOn('sb', step)

  return (
    <div className="bg-secondary/30 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[10px] text-primary-ink">
          CS3230 / NETWORK FLOW
        </p>
        <span className="font-mono text-[10px] text-muted-foreground">
          Step {step + 1} / {FLOW_STEPS.length}
        </span>
      </div>
      <p className="mt-2 font-editorial text-2xl">
        Ford–Fulkerson, step by step
      </p>
      <svg
        viewBox="0 0 420 240"
        role="img"
        aria-label="Flow network with source s, sink t and four intermediate nodes; augmenting paths fill in one at a time until the min cut is reached."
        className="mt-4 w-full rounded-sm border border-border bg-card font-mono text-[11px]"
      >
        <defs>
          <marker
            id="maxflow-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={FLOW_ARROW}
            markerHeight={FLOW_ARROW}
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M0 0 L10 5 L0 10 z" className="fill-muted-foreground" />
          </marker>
          <marker
            id="maxflow-arrow-active"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={FLOW_ARROW}
            markerHeight={FLOW_ARROW}
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M0 0 L10 5 L0 10 z" className="fill-primary-ink" />
          </marker>
        </defs>
        {FLOW_GEOMETRY.map((edge) => {
          const active = current.path.includes(edge.id)
          const flow = flowOn(edge.id, step)
          const saturated = flow === edge.cap
          return (
            <g key={edge.id}>
              <line
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                strokeWidth={active ? 3 : 2}
                markerEnd={`url(#maxflow-arrow${active ? '-active' : ''})`}
                className={`transition-[stroke,stroke-width] duration-300 ${
                  active
                    ? 'stroke-primary-ink'
                    : saturated
                      ? 'stroke-foreground'
                      : 'stroke-muted-foreground'
                }`}
              />
              {active ? (
                <line
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  strokeWidth={3}
                  strokeDasharray="4 8"
                  strokeLinecap="round"
                  className="maxflow-flow stroke-card"
                />
              ) : null}
              <text
                x={edge.label[0]}
                y={edge.label[1]}
                textAnchor="middle"
                className={`transition-colors duration-300 ${
                  active
                    ? 'fill-primary-ink font-semibold'
                    : saturated
                      ? 'fill-foreground'
                      : 'fill-muted-foreground'
                }`}
              >
                {flow}/{edge.cap}
              </text>
            </g>
          )
        })}
        <path
          d="M215 14 V96 Q215 110 229 110 H316 Q330 110 330 124 V232"
          fill="none"
          strokeWidth={2}
          strokeDasharray="6 5"
          className={`stroke-feedback-revisit-text transition-opacity duration-500 ${
            showCut ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <text
          x={272}
          y={16}
          className={`fill-feedback-revisit-text transition-opacity duration-500 ${
            showCut ? 'opacity-100' : 'opacity-0'
          }`}
        >
          min cut = 16
        </text>
        {(Object.keys(FLOW_NODES) as Array<FlowNode>).map((id) => {
          const [cx, cy] = FLOW_NODES[id]
          const terminal = id === 's' || id === 't'
          return (
            <g key={id}>
              <circle
                cx={cx}
                cy={cy}
                r={FLOW_NODE_RADIUS}
                strokeWidth={terminal ? 2 : 1.5}
                className={
                  terminal
                    ? 'fill-secondary stroke-primary-ink'
                    : 'fill-card stroke-foreground'
                }
              />
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                className={`text-xs ${
                  terminal
                    ? 'fill-primary-ink font-semibold'
                    : 'fill-foreground'
                }`}
              >
                {terminal ? id : id.toUpperCase()}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="mt-4 flex items-start justify-between gap-4">
        <p className="min-h-10 text-sm leading-5">{current.caption}</p>
        <span className="shrink-0 rounded-sm bg-card px-3 py-1.5 font-mono text-sm">
          flow {total}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
        <span>Pause</span>
        <span aria-hidden="true">·</span>
        <span>Change a capacity</span>
        <span aria-hidden="true">·</span>
        <span>Step back</span>
        <span className="ml-auto italic">
          Concept preview, not interactive yet
        </span>
      </div>
    </div>
  )
}
