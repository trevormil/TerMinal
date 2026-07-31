// Shared between the electron main process and the renderer, so the fan-out cap
// is stated once. The renderer cannot import src/main/*, and a duplicated
// literal `4` in the entrant picker would silently drift from the real gate.

/** Hard ceiling on parallel bake-off entrants. */
export const MAX_BAKEOFF_ENTRANTS = 4
