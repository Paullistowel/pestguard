const { getDefaultConfig } = require('expo/metro-config');

// The `@/*` -> `src/*` alias comes from tsconfig.json: Expo's Metro config
// reads tsconfig paths directly on SDK 50+, so no extra resolver setup or
// babel-plugin-module-resolver is needed here.
module.exports = getDefaultConfig(__dirname);
