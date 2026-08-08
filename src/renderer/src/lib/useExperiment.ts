import { useEffect, useState } from 'react'
import { experimentEnabled, type ExperimentId } from '../../../shared/experiments'
import type { Settings } from './types'

/**
 * Is this experiment on? The renderer-side gate for a flagged feature.
 *
 * Fetches settings the way every other component does (`window.gt.settings.get`
 * on mount) and then follows the `gt.settings.changed` event SettingsPanel
 * dispatches on save, so flipping a flag lights the feature up without a window
 * reload. Starts `false`: the pre-fetch frame must not flash a flagged-off
 * feature into view.
 *
 * Server-side rejection is a separate concern — an IPC handler behind a flag
 * calls experimentEnabled(readSettings(), id) in main. Hiding UI is not a gate.
 */
export function useExperiment(id: ExperimentId): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let live = true
    void window.gt.settings
      .get()
      .then((s) => {
        if (live) setOn(experimentEnabled(s, id))
      })
      .catch(() => {})
    const onChanged = (e: Event) => {
      const next = (e as CustomEvent<Settings | undefined>).detail
      // The event carries the saved Settings; re-fetch only if it didn't.
      if (next) setOn(experimentEnabled(next, id))
      else void window.gt.settings.get().then((s) => live && setOn(experimentEnabled(s, id)))
    }
    window.addEventListener('gt.settings.changed', onChanged)
    return () => {
      live = false
      window.removeEventListener('gt.settings.changed', onChanged)
    }
  }, [id])
  return on
}
