import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '/pretext.js': '/node_modules/@chenglou/pretext/dist/layout.js',
    },
  },
})
