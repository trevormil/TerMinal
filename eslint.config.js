import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

// Deliberately narrow: prettier already owns formatting, so lint only carries
// the high-signal correctness rules a formatter and tsc cannot catch
// (hook misuse, unawaited promises, dead bindings). See docs/decisions.
export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'vendor/**', 'node_modules/**', 'templates/**'],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    // The codebase carries eslint-disable comments for stock rules this narrow
    // config never turns on, so "unused directive" reports would be noise.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  // bin/ — 189KB of PRODUCTION Bun scripts that eslint never saw (ticket 101).
  //
  // The exclusion was incidental, not deliberate: these files are EXTENSIONLESS,
  // so `eslint .` simply never picked them up (the same reason .prettierignore
  // skips bin). `terminal-cron` is precisely where a dropped promise fails
  // silently — no window, no user, no Activity entry; the scheduled run just
  // does less than it claimed to.
  //
  // Type-aware coverage was the point, so it is NOT skipped here:
  // `allowDefaultProject` puts these files on the default TS project, which is
  // what `no-floating-promises` needs. Settling for the non-type-aware subset
  // would have left out the one rule that motivates the ticket.
  {
    files: ['bin/terminal-*', 'bin/gt-notify'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['bin/terminal-*', 'bin/gt-notify'],
        },
        tsconfigRootDir: import.meta.dirname,
        // The project service keys off the extension, and these files have
        // none. Without this it refuses them outright and the type-aware rules
        // never run — which is the whole point of putting them here.
        extraFileExtensions: [''],
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  // The UX suite and its scripts: same correctness rules, minus react-hooks —
  // that plugin reads Playwright's `use()` fixture callback as a React hook.
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
)
