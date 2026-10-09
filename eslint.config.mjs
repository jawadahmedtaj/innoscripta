import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', '.runtime/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': ['error', { patterns: [
        { group: ['**/apps/people/**', '**/apps/delivery/**', '**/apps/shell/**'], message: 'Apps consume public contracts, not sibling source.' }
      ] }]
    }
  },
  { files: ['tests/**'], rules: { 'no-restricted-imports': 'off' } }
);
