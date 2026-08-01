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
)
