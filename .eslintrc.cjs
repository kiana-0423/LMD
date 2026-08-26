module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true,
    node: true
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true
    }
  },
  plugins: ["@typescript-eslint", "react-hooks", "react-refresh"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
    "prettier"
  ],
  ignorePatterns: ["dist", "src-tauri/gen", "src-tauri/target"],
  rules: {
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }]
  },
  overrides: [
    {
      // Production UI must never reach into the browser-demo modules. Only the API adapter layer
      // in src/lib/api chooses between a real Tauri command and demo data, and it does so at
      // runtime through `invokeOrMock`.
      files: ["src/features/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/layouts/**/*.{ts,tsx}", "src/routes/**/*.{ts,tsx}"],
      excludedFiles: ["**/__tests__/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/api.mock", "**/mockData", "**/mockStructure"],
                message:
                  "Browser-demo modules must not be imported by production components. Route through src/lib/api, which falls back to demo data only outside the Tauri runtime."
              }
            ]
          }
        ]
      }
    }
  ]
};
