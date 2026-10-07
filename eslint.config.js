import js from '@eslint/js';
import {defineConfig} from '@eslint/config-helpers';

// Not the GNOME Shell config (it isn't published on npm): ESLint's recommended
// rules plus the style rules the shell itself enforces.
export default defineConfig([
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {
                global: 'readonly',
                console: 'readonly',
                TextDecoder: 'readonly',
                TextEncoder: 'readonly',
                globalThis: 'readonly',
                process: 'readonly',
                URL: 'readonly',
            },
        },
        rules: {
            'camelcase': ['error', {properties: 'never'}],
            'comma-dangle': ['error', {
                arrays: 'always-multiline',
                objects: 'always-multiline',
                imports: 'always-multiline',
                exports: 'always-multiline',
                functions: 'never',
            }],
            'consistent-return': 'error',
            'eqeqeq': ['error', 'smart'],
            'eol-last': 'error',
            'indent': ['error', 4, {
                SwitchCase: 0,
                ignoredNodes: ['CallExpression > ClassExpression.arguments'],
            }],
            'key-spacing': ['error', {mode: 'minimum', beforeColon: false, afterColon: true}],
            'no-trailing-spaces': 'error',
            'no-unused-vars': ['error', {args: 'none'}],
            'object-curly-spacing': ['error', 'never'],
            'prefer-arrow-callback': 'error',
            'prefer-const': ['error', {destructuring: 'all'}],
            'quotes': ['error', 'single', {avoidEscape: true, allowTemplateLiterals: true}],
            'semi': ['error', 'always'],
        },
    },
]);
