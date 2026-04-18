const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all files in the monorepo so Metro can resolve workspace packages
config.watchFolders = [monorepoRoot];

// Let Metro know where to find packages — project node_modules first, then root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Prefer .native.ts platform extensions for workspace packages
config.resolver.sourceExts = [
  'native.ts',
  'native.tsx',
  ...config.resolver.sourceExts,
];

// Force all packages to use the same React instance from the app's node_modules,
// preventing the monorepo root's React 19 from being picked up by shared packages.
// Must include sub-paths like react/jsx-runtime and react/jsx-dev-runtime — React 19's
// jsx-dev-runtime accesses __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
// which doesn't exist in React 18, causing a TypeError on recentlyCreatedOwnerStacks.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === 'react' ||
    moduleName === 'react/jsx-runtime' ||
    moduleName === 'react/jsx-dev-runtime' ||
    moduleName === 'react-native'
  ) {
    return {
      filePath: require.resolve(moduleName, { paths: [projectRoot] }),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
