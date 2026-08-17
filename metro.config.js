const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// v1.1.4: cho phép Metro pack tile ảnh (jpg/png) đóng gói offline
const { assetExts } = config.resolver;
config.resolver.assetExts = [...assetExts];

module.exports = config;
