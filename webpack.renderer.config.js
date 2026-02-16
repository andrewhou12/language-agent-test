const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const commonConfig = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader', 'postcss-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
};

module.exports = [
  // Control Panel Window
  {
    ...commonConfig,
    entry: './src/renderer/control/index.tsx',
    target: 'electron-renderer',
    output: {
      filename: 'control.js',
      path: path.resolve(__dirname, 'dist/renderer/control'),
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/renderer/control/index.html',
        filename: 'index.html',
      }),
    ],
  },
  // Overlay Window
  {
    ...commonConfig,
    entry: './src/renderer/overlay/index.tsx',
    target: 'electron-renderer',
    output: {
      filename: 'overlay.js',
      path: path.resolve(__dirname, 'dist/renderer/overlay'),
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/renderer/overlay/index.html',
        filename: 'index.html',
      }),
    ],
  },
  // Preload scripts
  {
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    entry: {
      'preload-control': './src/main/preload-control.ts',
      'preload-overlay': './src/main/preload-overlay.ts',
    },
    target: 'electron-preload',
    devtool: 'source-map',
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    output: {
      filename: '[name].js',
      path: path.resolve(__dirname, 'dist/main'),
    },
  },
];
