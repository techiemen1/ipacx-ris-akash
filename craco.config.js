// craco.config.js
module.exports = {
  devServer: (devServerConfig) => {
    devServerConfig.client = {
      ...devServerConfig.client,
      overlay: false,
      reconnect: false,
    };
    devServerConfig.webSocketServer = false;
    return devServerConfig;
  },
  webpack: {
    configure: (webpackConfig) => {
      webpackConfig.ignoreWarnings = [
        {
          message: /Critical dependency: the request of a dependency is an expression/,
        },
      ];
      return webpackConfig;
    },
  },
  jest: {
    configure: (jestConfig) => {
      jestConfig.transformIgnorePatterns = [
        "/node_modules/(?!(axios)/)",
      ];
      jestConfig.moduleNameMapper = {
        "^axios$": require.resolve("axios"),
      };
      return jestConfig;
    },
  },
};
