// Learn more: https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/#web-setup
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web build ships wa-sqlite as a .wasm asset.
config.resolver.assetExts.push('wasm');

module.exports = config;
