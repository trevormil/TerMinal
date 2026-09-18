// The domain vocabulary shared by main, preload, and the renderer.
//
// One declaration per type, in exactly one place. Before this, every one of
// these names existed twice — once next to the main-process module that produced
// it, and once in the renderer's hand-written `lib/types.ts` mirror — and
// nothing made the two agree. A field added on one side and forgotten on the
// other typechecked fine and shipped.
//
// Rule for anything that lands here: NO electron, NO node builtins, no runtime
// side effects. These files are imported by the sandboxed renderer, so a single
// `import { app } from 'electron'` in this folder breaks the renderer build.
// `src/shared/types/purity.test.ts` enforces it.
export type * from './activity'
export type * from './agents'
export type * from './app'
export type * from './ci'
export type * from './docs'
export type * from './git'
export type * from './github-review'
export type * from './knowledge'
export type * from './local-checks'
export type * from './monitors'
export type * from './mrs'
export type * from './observability'
export type * from './persistent-agents'
export type * from './runs'
export type * from './schedules'
export type * from './sessions'
export type * from './settings'
export type * from './tickets'
export type * from './workspace'
export type * from './session-timeline'
