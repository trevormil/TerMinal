// Syntax highlighting coverage — "highlighting everywhere", not just the 31
// extensions the Files tab originally knew.
//
// Values MUST be real @uiw/codemirror-extensions-langs keys (verified against
// its export list); an invented key silently yields no parser and therefore no
// highlighting, which is the exact bug the old map's comment warned about.
//
// Pure and dependency-free so it can be unit tested without loading CodeMirror.

/** extension (lowercase, no dot) → langs key */
const BY_EXT: Record<string, string> = {
  // web / js
  ts: 'ts',
  tsx: 'tsx',
  mts: 'ts',
  cts: 'ts',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  vue: 'vue',
  svelte: 'svelte',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  styl: 'styl',
  pug: 'pug',
  jade: 'jade',
  hbs: 'handlebars',
  handlebars: 'handlebars',
  liquid: 'liquid',
  j2: 'jinja2',
  jinja: 'jinja2',
  jinja2: 'jinja2',
  // data / config
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  jsonld: 'jsonld',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  properties: 'properties',
  env: 'properties',
  xml: 'xml',
  xsd: 'xsd',
  xsl: 'xsl',
  svg: 'svg',
  dtd: 'dtd',
  plist: 'xml',
  proto: 'proto',
  graphql: 'js',
  gql: 'js',
  // systems
  c: 'c',
  h: 'c',
  'c++': 'cpp',
  cpp: 'cpp',
  cxx: 'cxx',
  cc: 'cc',
  hpp: 'hpp',
  hh: 'hh',
  hxx: 'hxx',
  rs: 'rs',
  go: 'go',
  zig: 'c',
  d: 'd',
  nim: 'python',
  swift: 'swift',
  dart: 'dart',
  m: 'm',
  mm: 'mm',
  // jvm / .net
  java: 'java',
  kt: 'kt',
  kts: 'kts',
  gradle: 'gradle',
  groovy: 'groovy',
  scala: 'scala',
  sc: 'scala',
  cs: 'cs',
  fs: 'fs',
  vb: 'vb',
  // scripting
  py: 'python',
  pyw: 'pyw',
  pyx: 'pyx',
  pxd: 'pxd',
  rb: 'rb',
  gemfile: 'rb',
  rake: 'rb',
  php: 'php',
  php5: 'php5',
  phtml: 'phtml',
  pl: 'pl',
  pm: 'pm',
  lua: 'lua',
  tcl: 'tcl',
  r: 'r',
  jl: 'jl',
  ps1: 'ps1',
  psm1: 'psm1',
  psd1: 'psd1',
  sh: 'sh',
  bash: 'bash',
  zsh: 'sh',
  ksh: 'ksh',
  fish: 'sh',
  // functional
  hs: 'hs',
  ml: 'ml',
  mli: 'mli',
  elm: 'elm',
  clj: 'clj',
  cljs: 'cljs',
  cljc: 'cljc',
  edn: 'edn',
  el: 'el',
  lisp: 'lisp',
  scm: 'scm',
  erl: 'erl',
  ex: 'erl',
  exs: 'erl',
  // db / query
  sql: 'sql',
  cql: 'cql',
  sparql: 'sparql',
  rq: 'rq',
  cypher: 'cypher',
  // hardware / science
  v: 'v',
  sv: 'sv',
  svh: 'svh',
  vhd: 'vhd',
  vhdl: 'vhdl',
  f: 'f',
  f90: 'f90',
  f95: 'f95',
  for: 'for',
  tex: 'tex',
  ltx: 'ltx',
  nb: 'nb',
  wl: 'wl',
  // misc
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  mkd: 'mkd',
  diff: 'diff',
  patch: 'patch',
  cmake: 'cmake',
  nix: 'nix',
  solidity: 'solidity',
  sol: 'solidity',
  coffee: 'coffee',
  feature: 'feature',
  st: 'st',
  pas: 'pas',
  asm: 's',
  s: 's',
  wat: 'wat',
  wast: 'wast',
}

/**
 * Files with no extension (or a leading dot) that are still code. Matched on
 * the exact basename, lowercased — Dockerfile, Makefile, .zshrc and friends
 * previously got no highlighting at all.
 */
const BY_NAME: Record<string, string> = {
  dockerfile: 'sh', // no docker grammar; sh is close enough to be useful
  containerfile: 'sh',
  makefile: 'cmake',
  gnumakefile: 'cmake',
  rakefile: 'rb',
  gemfile: 'rb',
  brewfile: 'rb',
  podfile: 'rb',
  vagrantfile: 'rb',
  jenkinsfile: 'groovy',
  '.bashrc': 'bash',
  '.bash_profile': 'bash',
  '.zshrc': 'sh',
  '.zprofile': 'sh',
  '.profile': 'sh',
  '.env': 'properties',
  '.gitconfig': 'ini',
  '.editorconfig': 'ini',
  '.npmrc': 'ini',
  '.gitignore': 'properties',
  '.dockerignore': 'properties',
  '.eslintrc': 'json',
  '.prettierrc': 'json',
  '.babelrc': 'json',
}

export function basenameOf(path: string): string {
  return (path.split('/').pop() || path).toLowerCase()
}

/**
 * The @uiw/codemirror-extensions-langs key for a path, or '' when we have no
 * grammar. Extension wins; then the whole filename; then a dotfile whose name
 * after the dot is itself an extension (.eslintrc.json → json).
 */
export function langKeyFor(path: string): string {
  const name = basenameOf(path)
  if (BY_NAME[name]) return BY_NAME[name]
  const dot = name.lastIndexOf('.')
  if (dot > 0) {
    const ext = name.slice(dot + 1)
    if (BY_EXT[ext]) return BY_EXT[ext]
  }
  // Extensionless file that isn't a known name → no grammar.
  if (dot <= 0) return ''
  return ''
}

/** Every extension we can highlight — used by a test to guard the mapping. */
export const KNOWN_EXTENSIONS = Object.keys(BY_EXT)
export const KNOWN_FILENAMES = Object.keys(BY_NAME)
export const ALL_LANG_KEYS = [
  ...new Set([...Object.values(BY_EXT), ...Object.values(BY_NAME)]),
].sort()
