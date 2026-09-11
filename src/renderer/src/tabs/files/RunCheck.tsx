import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import type { LocalCheckPlan, LocalCheckResult } from '../../../../shared/types/local-checks'

export function RunCheck() {
  const [plan, setPlan] = useState<LocalCheckPlan | null>(null)
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState<LocalCheckResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    window.gt.files
      .checks()
      .then((next) => {
        if (!alive) return
        setPlan(next)
        setSelected(next.checks[0]?.id || '')
      })
      .catch(() => alive && setError('Could not discover local checks.'))
    return () => {
      alive = false
    }
  }, [])
  const check = plan?.checks.find((c) => c.id === selected)
  const run = async () => {
    if (!plan || !check || busy) return
    setBusy(true)
    setResult(null)
    setError('')
    try {
      setResult(await window.gt.files.runCheck(plan, selected))
    } catch {
      setError('Could not run the local check.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      aria-label="Local diagnostics"
      className="max-h-72 shrink-0 overflow-auto border-b border-[var(--gt-border)] p-3 text-xs"
    >
      <p>
        Run a local check on saved files. Package scripts execute project code and may modify files.
        Nothing runs on save.
      </p>
      {error || plan?.error ? (
        <p role="alert" className="mt-2 text-amber-400">
          {error || plan?.error}
        </p>
      ) : !plan ? (
        <p>Finding local checkers…</p>
      ) : (
        <>
          <div className="my-2 flex items-center gap-2">
            <select
              aria-label="Local checker"
              value={selected}
              disabled={busy}
              onChange={(e) => {
                setSelected(e.target.value)
                setResult(null)
              }}
              className="rounded border border-[var(--gt-border)] bg-[var(--gt-bg)] p-1"
            >
              {plan.checks.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                </option>
              ))}
            </select>
            <Button size="xs" disabled={busy || !check} onClick={run}>
              {busy ? 'Checking…' : 'Run selected check'}
            </Button>
          </div>
          {check && (
            <pre className="whitespace-pre-wrap break-all text-zinc-400">
              {plan.root}
              {'\n'}
              {[check.executable, ...check.args].join(' ')}
              {'\n'}
              {check.detail}
            </pre>
          )}
          <p className="mt-1 text-zinc-500">Two-minute limit. Output is capped.</p>
        </>
      )}
      {result && (
        <div role="status" className="mt-2">
          <strong>{result.summary}</strong>
          <pre className="mt-1 whitespace-pre-wrap break-all">
            {result.output || 'No diagnostic output.'}
          </pre>
        </div>
      )}
    </section>
  )
}
