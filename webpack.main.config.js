const path = require('path');

module.exports = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  entry: './src/main/main.ts',
  target: 'electron-main',
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
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist/main'),
  },
  externals: {
    'electron-store': 'commonjs electron-store',
  },
};
