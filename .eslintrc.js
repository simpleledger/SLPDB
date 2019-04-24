module.exports = {
  parser: '@typescript-eslint/parser',
  extends: ['plugin:@typescript-eslint/recommended'],
  parserOptions: {
    project: "./tsconfig.json"
  },
  plugins: ['@typescript-eslint'],
  rules: {
    '@typescript-eslint/camelcase': 'off',
    '@typescript-eslint/indent': 'off',
    'no-tabs': 'error',
    'no-trailing-spaces': 'error',
    'max-len': ['warn', { 'code': 150 }],
  }
}
