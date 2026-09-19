import biomeConfig from "eslint-config-biome";
import jsdocPlugin from "eslint-plugin-jsdoc";
import sonarjs from "eslint-plugin-sonarjs";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default [
  // 1. Global ignores
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "bun.lock",
      ".claude/**",
      ".planning/**",
      "node_modules/**",
      "declarations.d.ts"
    ]
  },

  // 2. TypeScript parser for all TS files
  tseslint.configs.base,

  // 3. Unicorn recommended + abbreviation allowlist
  eslintPluginUnicorn.configs.recommended,
  {
    rules: {
      "unicorn/prevent-abbreviations": [
        "error",
        {
          // Domain + framework vocabulary. Superset of the sibling frameworks'
          // allowlists (e.g. @moku-labs/web) so plugins authored or moved here lint
          // identically. Includes capitalized variants (Env, Api, …) for PascalCase
          // type names like EnvConfig/EnvApi. See references/glossary.md.
          allowList: {
            ctx: true,
            fn: true,
            cb: true,
            ref: true,
            Ref: true,
            args: true,
            Args: true,
            params: true,
            Params: true,
            props: true,
            Props: true,
            env: true,
            Env: true,
            i18n: true,
            I18n: true,
            l10n: true,
            spa: true,
            Spa: true,
            ssg: true,
            ssr: true,
            seo: true,
            api: true,
            Api: true,
            dev: true,
            Dev: true,
            prod: true,
            md: true,
            Md: true,
            dir: true,
            Dir: true,
            doc: true,
            Doc: true,
            docs: true,
            db: true,
            Db: true,
            gen: true,
            Gen: true,
            prev: true,
            temp: true,
            idx: true,
            val: true,
            fmt: true,
            len: true,
            util: true,
            utils: true,
            pkg: true,
            src: true,
            dist: true,
            Dist: true,
            config: true,
            cfg: true,
            e2e: true,
            cli: true,
            dom: true,
            css: true,
            html: true,
            url: true,
            uri: true,
            str: true,
            num: true,
            msg: true,
            err: true,
            req: true,
            res: true,
            opts: true,
            attr: true
          }
        }
      ]
    }
  },

  // 4. SonarJS recommended
  // NOTE: The `!` non-null assertion is required because sonarjs types mark `configs` as
  // potentially undefined, but the `recommended` preset always exists at runtime.
  // If this causes type errors in future sonarjs versions, use: `sonarjs.configs?.recommended ?? {}`
  // biome-ignore lint/style/noNonNullAssertion: sonarjs types mark configs as possibly undefined but it exists at runtime
  sonarjs.configs!.recommended,

  // 5. JSDoc TypeScript preset
  jsdocPlugin.configs["flat/recommended-typescript-error"],

  // 5b. JSDoc style overrides
  {
    rules: {
      "jsdoc/no-types": "off",
      "jsdoc/tag-lines": ["error", "never", { startLines: 1 }]
    }
  },

  // 6. Source files: strict JSDoc requirements
  {
    files: ["src/**/*.ts"],
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          require: {
            ArrowFunctionExpression: true,
            ClassDeclaration: true,
            FunctionDeclaration: true,
            FunctionExpression: true,
            MethodDefinition: true
          },
          contexts: ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"]
        }
      ],
      "jsdoc/require-description": "error",
      "jsdoc/require-param": "error",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/require-example": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "unicorn/require-module-specifiers": "off"
    }
  },

  // 6b. Build/CI tooling scripts: shared presets (unicorn, sonarjs, jsdoc) but
  //     without the strict src JSDoc/require-example bar — node scripts, not
  //     library source. Mirrors the sibling frameworks' config.
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "jsdoc/require-example": "off"
    }
  },

  // 7. Test files: relaxed rules
  {
    files: ["tests/**/*.ts", "src/**/__tests__/**/*.ts"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-example": "off",
      "unicorn/no-useless-undefined": "off",
      "sonarjs/no-duplicate-string": "off",
      "unicorn/prevent-abbreviations": "off"
    }
  },

  // 8. Config files: relaxed rules
  {
    files: ["*.config.ts"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
      "unicorn/no-abusive-eslint-disable": "off"
    }
  },

  // 9. MUST be last: eslint-config-biome disables rules Biome handles
  biomeConfig
];
