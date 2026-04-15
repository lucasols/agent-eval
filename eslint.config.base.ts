import js from '@eslint/js';
import { extendedLintPlugin } from '@ls-stack/extended-lint';
import eslintUnicornPlugin from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

const isCI = process.env.CI === 'true';

export const OFF = 0;
export const WARN = 1;
export const ERROR = 2;
export const ERROR_IN_CI = isCI ? ERROR : WARN;

type RuleLevel = 0 | 1 | 2 | 'off' | 'warn' | 'error';
type RuleEntry = RuleLevel | [RuleLevel, ...unknown[]];

export function createBaseConfig({
  globalRules = {},
  extraRuleGroups,
  extraIgnorePatterns,
  tsconfigRootDir,
  allowDefaultExport,
}: {
  globalRules?: Record<string, RuleEntry>;
  extraRuleGroups?: {
    plugins?: Record<string, unknown>;
    files?: string[];
    rules: Record<string, RuleEntry>;
  }[];
  extraIgnorePatterns?: string[];
  tsconfigRootDir: string;
  allowDefaultExport?: string[];
}): unknown {
  return tseslint.config(
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      linterOptions: { reportUnusedDisableDirectives: true },
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
        globals: { process: true },
      },
    },
    {
      plugins: {
        '@ls-stack': extendedLintPlugin,
        unicorn: eslintUnicornPlugin,
      },
      rules: {
        'no-constant-binary-expression': ERROR_IN_CI,
        'object-shorthand': ERROR_IN_CI,
        'no-useless-rename': ERROR_IN_CI,
        'no-param-reassign': ERROR_IN_CI,
        'prefer-template': ERROR_IN_CI,
        'prefer-const': [ERROR_IN_CI, { destructuring: 'all' }],
        'no-prototype-builtins': OFF,
        'no-inner-declarations': OFF,
        'no-undef': OFF,
        'no-console': [ERROR_IN_CI, { allow: ['warn', 'error', 'info'] }],
        'no-implicit-coercion': [
          ERROR_IN_CI,
          { disallowTemplateShorthand: true, allow: ['!!'] },
        ],
        'max-lines': [
          ERROR,
          { max: 800, skipBlankLines: true, skipComments: true },
        ],

        '@typescript-eslint/no-unnecessary-condition': ERROR,
        '@typescript-eslint/naming-convention': [
          'error',
          { selector: 'typeLike', format: ['PascalCase'] },
        ],
        '@typescript-eslint/only-throw-error': ERROR_IN_CI,
        '@typescript-eslint/no-unused-expressions': ERROR_IN_CI,
        '@typescript-eslint/no-unused-vars': [
          ERROR_IN_CI,
          {
            argsIgnorePattern: '_$',
            ignoreRestSiblings: true,
            varsIgnorePattern: '_$',
          },
        ],
        '@typescript-eslint/no-shadow': [
          ERROR_IN_CI,
          { ignoreOnInitialization: true, allow: ['expect'] },
        ],
        '@typescript-eslint/no-unsafe-call': ERROR_IN_CI,
        '@typescript-eslint/no-explicit-any': ERROR,
        '@typescript-eslint/no-unsafe-member-access': ERROR_IN_CI,
        '@typescript-eslint/ban-ts-comment': ERROR,
        '@typescript-eslint/prefer-optional-chain': ERROR,
        '@typescript-eslint/no-non-null-assertion': ERROR,
        '@typescript-eslint/consistent-type-assertions': [
          ERROR,
          { assertionStyle: 'never' },
        ],
        '@typescript-eslint/restrict-template-expressions': [
          ERROR_IN_CI,
          { allowNullish: false },
        ],
        '@typescript-eslint/no-deprecated': ERROR,
        '@typescript-eslint/no-misused-promises': OFF,
        '@typescript-eslint/no-unsafe-argument': OFF,

        '@ls-stack/no-unused-type-props-in-args': ERROR,
        '@ls-stack/improved-no-unnecessary-condition': ERROR,
        '@ls-stack/no-default-export': ERROR,
        '@ls-stack/no-unnecessary-casting': [
          ERROR_IN_CI,
          { additionalCastFunctions: [] },
        ],
        '@ls-stack/use-top-level-regex': ERROR,

        'unicorn/require-array-join-separator': ERROR,
        'unicorn/no-empty-file': ERROR,
        'unicorn/no-array-reduce': [ERROR, { allowSimpleOperations: true }],
        'unicorn/no-array-for-each': ERROR,
        ...globalRules,
      },
    },
    {
      files: [
        '**/eslint.config.ts',
        '**/vitest.config.ts',
        ...(allowDefaultExport ?? []),
      ],
      rules: {
        '@ls-stack/no-default-export': OFF,
      },
    },
    ...(extraRuleGroups ?? []),
    {
      ignores: [
        'dist/**',
        'build/**',
        'node_modules/**',
        '**/*.d.ts',
        'eslint.config.ts',
        ...(extraIgnorePatterns ?? []),
      ],
    },
  );
}
