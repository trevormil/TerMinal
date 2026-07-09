/// <reference types="vite/client" />

// Build stamp, injected by electron.vite.config.ts `define` at build time.
declare const __BUILD_SHA__: string
declare const __BUILD_BRANCH__: string
declare const __BUILD_TIME__: string
