import {
  MAP_ANCHORS,
  MAP_DOTS,
  MAP_DOTS_EUROPE,
  MAP_EUROPE,
  MAP_HEIGHT,
  MAP_WIDTH,
} from '#/lib/world-map'

export interface CountryPoint {
  code: string
  name: string
  servers: number
  users: number
}

interface View {
  x: number
  y: number
  w: number
  h: number
}

const WORLD: View = { x: 0, y: 0, w: MAP_WIDTH, h: MAP_HEIGHT }
// Europe, in map units: most self-hosted homeservers end up here.
const EUROPE: View = MAP_EUROPE

const inside = (v: View, [x, y]: readonly [number, number]) =>
  x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h

/**
 * Dot-matrix world map with one glowing point per country hosting
 * homeservers, plus a zoom on Europe when several countries crowd there.
 */
export function WorldMap({
  points,
  onPick,
}: {
  points: Array<CountryPoint>
  onPick?: (name: string) => void
}) {
  const placed = points
    .filter((p) => MAP_ANCHORS[p.code])
    // Big points first, so small neighbours stay clickable on top.
    .sort((a, b) => b.servers - a.servers)
  const inEurope = placed.filter((p) => inside(EUROPE, MAP_ANCHORS[p.code]))
  const zoom = inEurope.length >= 2

  return (
    <div
      className={`grid grid-cols-1 gap-4 ${zoom ? 'md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]' : ''}`}
    >
      <figure className="m-0 min-w-0">
        <MapView
          view={WORLD}
          points={placed}
          onPick={onPick}
          pointScale={1}
          box={zoom ? EUROPE : null}
          label={`World map: homeservers in ${placed.map((p) => `${p.name} (${p.servers})`).join(', ')}`}
        />
      </figure>
      {zoom ? (
        <figure className="m-0 min-w-0">
          <MapView
            view={EUROPE}
            points={inEurope}
            onPick={onPick}
            pointScale={0.32}
            labels
            label={`Zoom on Europe: ${inEurope.map((p) => `${p.name} (${p.servers})`).join(', ')}`}
          />
          <figcaption className="mt-1 text-xs text-dim">
            zoom: Europe
          </figcaption>
        </figure>
      ) : null}
    </div>
  )
}

function MapView({
  view,
  points,
  onPick,
  pointScale,
  labels = false,
  box = null,
  label,
}: {
  view: View
  points: Array<CountryPoint>
  onPick?: (name: string) => void
  /** Points are sized in map units: shrink them when the view is zoomed in. */
  pointScale: number
  labels?: boolean
  box?: View | null
  label: string
}) {
  const zoomed = view === EUROPE
  const dot = zoomed ? 1.05 : 3.2
  return (
    <svg
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className="block h-auto w-full"
      role="img"
      aria-label={label}
    >
      <path
        d={zoomed ? MAP_DOTS_EUROPE : MAP_DOTS}
        stroke="var(--line)"
        strokeWidth={dot}
        strokeLinecap="round"
        fill="none"
      />
      {box ? (
        <rect
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          fill="none"
          stroke="var(--dim)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
        />
      ) : null}
      {points.map((p) => {
        const [x, y] = MAP_ANCHORS[p.code]
        const r = (3.5 + 2.5 * Math.sqrt(p.servers)) * pointScale
        // Label on the left when a neighbour sits just to the right.
        const crowded = points.some((o) => {
          const [ox, oy] = MAP_ANCHORS[o.code]
          return o !== p && ox > x && ox - x < 16 && Math.abs(oy - y) < 6
        })
        const title = `${p.name}: ${p.servers} homeserver${p.servers > 1 ? 's' : ''}, ${p.users} user${p.users > 1 ? 's' : ''}`
        return (
          <g
            key={p.code}
            className={onPick ? 'cursor-pointer' : undefined}
            onClick={onPick ? () => onPick(p.name) : undefined}
          >
            <title>{title}</title>
            <circle
              cx={x}
              cy={y}
              r={r * 2.6}
              fill="var(--green)"
              opacity={0.12}
              className="map-pulse"
            />
            <circle
              cx={x}
              cy={y}
              r={r}
              fill="var(--green)"
              stroke="var(--void)"
              strokeWidth={1.5 * pointScale}
            />
            {labels ? (
              <text
                x={crowded ? x - r - 1.5 : x + r + 1.5}
                y={y}
                textAnchor={crowded ? 'end' : 'start'}
                dominantBaseline="middle"
                fontSize={4.2}
                fill="var(--text)"
                stroke="var(--panel)"
                strokeWidth={1}
                paintOrder="stroke"
                className="font-mono"
              >
                {p.code} {p.servers}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
