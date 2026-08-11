module.exports = function (api) {
  api.cache(true);
  return {
    // `babel-preset-expo` handles everything this project needs: JSX, the
    // `@/*` path aliases from tsconfig.json, and — because Reanimated is
    // installed — the worklets plugin, which moved out of
    // `react-native-reanimated/plugin` in Reanimated 4. Adding it by hand here
    // would double-apply it.
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
  };
};
