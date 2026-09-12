import { resolve } from 'path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
import autoprefixer from 'autoprefixer';
import autoImports from 'unplugin-auto-import/vite';
import svgLoader from 'vite-svg-loader';
import vueSetupExtend from 'vite-plugin-vue-setup-extend-plus';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/vue-ad-editor/' : '/',
  plugins: [
    vue(),
    VueI18nPlugin({
      include: resolve(__dirname, 'src/language/*.json'),
      runtimeOnly: true,
      compositionOnly: true,
    }),
    autoImports({ imports: ['vue'], dts: './typings/auto-imports.d.ts' }),
    vueSetupExtend(),
    vueJsx(),
    svgLoader(),
  ],
  build: {
    target: 'es2015',
    outDir: resolve(__dirname, 'dist'),
    assetsDir: 'assets',
    assetsInlineLimit: 8192,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      output: {
        chunkFileNames: 'js/[name].[hash].js',
        entryFileNames: 'js/[name].[hash].js',
      },
    },
  },
  resolve: {
    alias: [
      { find: /^@\//, replacement: resolve(__dirname, 'src') + '/' },
      { find: /^~/, replacement: '' },
      { find: 'vue-i18n', replacement: 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js' },
    ],
    extensions: ['.ts', '.tsx', '.js', '.mjs', '.vue', '.json', '.less', '.css'],
  },
  css: {
    postcss: { plugins: [autoprefixer()] },
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
        additionalData: `@import '${resolve(__dirname, 'src/styles/variable.less')}';`,
      },
    },
  },
  server: { port: 3000, open: false },
  preview: { port: 5000 },
}));
