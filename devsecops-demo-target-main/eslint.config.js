module.exports = [
  {
    files: ["src/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        Buffer: "readonly",
        module: "readonly",
        require: "readonly"
      }
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { "argsIgnorePattern": "^(context|_)"}]
    }
  }
];
