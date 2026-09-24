import { memo, useState, useSyncExternalStore } from 'react'
import { motion } from 'motion/react'

import type { Transition } from 'motion/react'

const MOTION_QUERY =
  '(min-width: 1024px) and (prefers-reduced-motion: no-preference)'
const COLUMNS = Array.from({ length: 16 }, (_, i) => i * 48)
const ROWS = Array.from({ length: 21 }, (_, i) => i * 48)
const PANELS = [
  { x: 48, y: 144, dx: 48, dy: -48 },
  { x: 528, y: 288, dx: -48, dy: 48 },
  { x: 96, y: 672, dx: 96, dy: 0 },
  { x: 480, y: 816, dx: -48, dy: -48 },
]
const TRACES = [
  {
    d: 'M0 192H192V96H336',
    x: [0, 0, 0, 192, 192, 336, 336],
    y: [192, 192, 192, 192, 96, 96, 96],
  },
  {
    d: 'M720 384H576V528H672',
    x: [720, 720, 720, 576, 576, 672, 672],
    y: [384, 384, 384, 384, 528, 528, 528],
  },
  {
    d: 'M48 864H288V720H432',
    x: [48, 48, 48, 288, 288, 432, 432],
    y: [864, 864, 864, 864, 720, 720, 720],
  },
]
const CYCLE: Transition = {
  duration: 18,
  times: [0, 0.12, 0.3, 0.48, 0.66, 0.86, 1],
  ease: 'easeInOut',
  repeat: Infinity,
  repeatDelay: 4,
}
const STILL: Transition = { duration: 0 }

function subscribe(onChange: () => void) {
  const query = window.matchMedia(MOTION_QUERY)
  query.addEventListener('change', onChange)
  document.addEventListener('visibilitychange', onChange)
  return () => {
    query.removeEventListener('change', onChange)
    document.removeEventListener('visibilitychange', onChange)
  }
}

function canAnimate() {
  return (
    window.matchMedia(MOTION_QUERY).matches &&
    document.visibilityState === 'visible'
  )
}

export const LoginGrid = memo(function LoginGrid() {
  const enabled = useSyncExternalStore(subscribe, canAnimate, () => false)
  const [paused, setPaused] = useState(false)
  const running = enabled && !paused

  return (
    <>
      <svg
        data-login-grid=""
        data-motion={!enabled ? 'static' : paused ? 'paused' : 'running'}
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 720 960"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        className="pointer-events-none absolute inset-0 z-0 size-full"
      >
        <g stroke="#C9DAD6" strokeWidth="1">
          {COLUMNS.map((x, i) => {
            const shift = i % 4 === 1 ? 48 : i % 4 === 3 ? -24 : 0
            return (
              <motion.path
                key={x}
                d={`M${x} 0V960`}
                vectorEffect="non-scaling-stroke"
                initial={false}
                animate={
                  running
                    ? {
                        x: [0, 0, shift, shift, -shift / 2, 0, 0],
                        opacity: [0.08, 0.08, 0.04, 0.06, 0.07, 0.08, 0.08],
                      }
                    : { x: 0, opacity: 0.08 }
                }
                transition={running ? { ...CYCLE, delay: i * 0.06 } : STILL}
              />
            )
          })}
          {ROWS.map((y, i) => {
            const shift = i % 4 === 1 ? -48 : i % 4 === 3 ? 24 : 0
            return (
              <motion.path
                key={y}
                d={`M0 ${y}H720`}
                vectorEffect="non-scaling-stroke"
                initial={false}
                animate={
                  running
                    ? {
                        y: [0, 0, -shift / 2, shift, shift, 0, 0],
                        opacity: [0.08, 0.08, 0.06, 0.04, 0.07, 0.08, 0.08],
                      }
                    : { y: 0, opacity: 0.08 }
                }
                transition={
                  running ? { ...CYCLE, delay: 0.8 + i * 0.05 } : STILL
                }
              />
            )
          })}
        </g>
        {PANELS.map((panel, i) => (
          <motion.g
            key={panel.x}
            initial={false}
            animate={
              running
                ? {
                    x: [0, 0, panel.dx, panel.dx, 0, 0, 0],
                    y: [0, 0, 0, panel.dy, panel.dy, 0, 0],
                    opacity: [0, 0, 1, 1, 0.7, 0, 0],
                  }
                : { x: 0, y: 0, opacity: 0 }
            }
            transition={running ? { ...CYCLE, delay: i * 0.4 } : STILL}
          >
            <motion.rect
              x={panel.x}
              y={panel.y}
              fill="#5CD1BE"
              fillOpacity="0.035"
              stroke="#5CD1BE"
              strokeOpacity="0.2"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              initial={false}
              animate={
                running
                  ? {
                      width: [48, 48, 144, 96, 96, 48, 48],
                      height: [48, 48, 48, 96, 96, 48, 48],
                    }
                  : { width: 48, height: 48 }
              }
              transition={running ? { ...CYCLE, delay: i * 0.4 } : STILL}
            />
          </motion.g>
        ))}
        {TRACES.map((trace, i) => (
          <g key={trace.d}>
            <motion.path
              d={trace.d}
              stroke="#5CD1BE"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
              initial={false}
              animate={
                running
                  ? {
                      pathLength: [0, 0, 0, 0.45, 0.75, 1, 1],
                      opacity: [0, 0, 0, 0.22, 0.22, 0, 0],
                    }
                  : { pathLength: 0, opacity: 0 }
              }
              transition={running ? { ...CYCLE, delay: i * 0.35 } : STILL}
            />
            <motion.rect
              x="-2"
              y="-2"
              width="4"
              height="4"
              fill="#5CD1BE"
              initial={false}
              animate={
                running
                  ? {
                      x: trace.x,
                      y: trace.y,
                      opacity: [0, 0, 0, 0.4, 0.4, 0, 0],
                    }
                  : { x: trace.x[0], y: trace.y[0], opacity: 0 }
              }
              transition={running ? { ...CYCLE, delay: i * 0.35 } : STILL}
            />
          </g>
        ))}
      </svg>
      {enabled && (
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          className="absolute bottom-1 right-8 z-20 min-h-8 rounded-sm px-2 py-1 font-mono text-[11px] text-[#8FA7A2] underline-offset-4 transition-colors hover:text-[#C9DAD6] hover:underline focus-visible:outline-[#5CD1BE] xl:right-14 [@media(pointer:coarse)]:min-h-11"
        >
          {paused ? 'Resume background motion' : 'Pause background motion'}
        </button>
      )}
    </>
  )
})
