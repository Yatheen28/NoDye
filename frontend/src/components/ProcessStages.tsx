import { PIPELINE_STAGES } from '../lib/pipeline'

/** Pipeline checklist shown beside the brain visualizer. */
type StageState = 'pending' | 'active' | 'done' | 'failed'

interface ProcessStagesProps {
  /** Raw backend progress, 0..100 (not the smoothed display value). */
  progress: number
  /** True once a run has been started (upload in flight or task created). */
  started: boolean
  complete: boolean
  failed: boolean
  /** Secondary text for the active stage, e.g. "Slice 40/155". */
  detail?: string | null
}

function stateFor(index: number, p: number, started: boolean, complete: boolean, failed: boolean): StageState {
  if (complete) return 'done'
  if (!started) return 'pending'
  const isLast = index === PIPELINE_STAGES.length - 1
  const start = PIPELINE_STAGES[index].at
  const next = isLast ? Infinity : PIPELINE_STAGES[index + 1].at
  if (p >= next) return 'done'
  if (p >= start) return failed ? 'failed' : 'active'
  return 'pending'
}

export function ProcessStages({ progress, started, complete, failed, detail }: ProcessStagesProps) {
  return (
    <ol className="process-stages" aria-label="Processing stages">
      {PIPELINE_STAGES.map((s, i) => {
        const state = stateFor(i, progress, started, complete, failed)
        return (
          <li key={s.key} className={`process-stage is-${state}`}>
            <span className="process-stage__marker" aria-hidden="true">
              {state === 'done' ? (
                <svg viewBox="0 0 12 12" width="10" height="10">
                  <path
                    d="M2 6.2 4.8 9 10 3.4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : state === 'failed' ? (
                '!'
              ) : null}
            </span>
            <span className="process-stage__body">
              <span className="process-stage__label">{s.label}</span>
              {state === 'active' && detail && (
                <span className="process-stage__detail">{detail}</span>
              )}
            </span>
            <span className="process-stage__pct mono">{s.at}%</span>
          </li>
        )
      })}
    </ol>
  )
}
