import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['backend/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './backend/tsconfig.json'
      },
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './frontend/tsconfig.json'
      },
      globals: {
        ...globals.browser
      }
    }
  },
  {
    files: ['shared/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './shared/tsconfig.json'
      }
    }
  }
);
