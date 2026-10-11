import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.base],
    rules: {
      'space-unary-ops': ['error', { words: true, nonwords: false, overrides: { '!': true } }],
      'quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      'semi': ['error', 'never'],
      'indent': ['error', 2, { SwitchCase: 1, ignoredNodes: ['CallExpression > ObjectExpression', 'CallExpression > ObjectExpression *', 'CallExpression > ArrowFunctionExpression > BlockStatement', 'CallExpression > ArrowFunctionExpression > BlockStatement *'] }],
      'no-var': 'error',
      'prefer-const': 'error',
      'space-before-blocks': 'error',
      'arrow-spacing': 'error',
      'spaced-comment': ['error', 'always'],
      'curly': ['error', 'all'],
    },
  },
)
