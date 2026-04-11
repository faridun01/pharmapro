import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  loadEnv(mode, '.', '');
  const isProd = mode === 'production';
  const warmupClientFiles = [
    './index.html',
    './src/main.tsx',
    './src/AppRoot.tsx',
    './src/App.tsx',
    './src/index.css',
  ];

  return {
    base: './',
    plugins: [react(), tailwindcss()],
    define: {
      '__DEV__': JSON.stringify(!isProd),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      warmup: {
        clientFiles: warmupClientFiles,
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react/jsx-runtime',
        'react-dom/client',
        'react-i18next',
        'i18next',
        'lucide-react',
        'motion/react',
        'recharts',
        'clsx',
        'tailwind-merge',
        'xlsx',
        'jspdf',
        'jspdf-autotable',
      ],
    },
    build: {
      // Production optimizations
      minify: isProd ? 'esbuild' : false,
      target: 'ES2022',
      manifest: isProd,
      sourcemap: isProd ? false : 'inline',
      
      // Chunk splitting strategy
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-ui': ['lucide-react'],
            'vendor-i18n': ['i18next', 'react-i18next'],
          },
          chunkFileNames: isProd ? 'js/[name].[hash].js' : 'js/[name].js',
          entryFileNames: isProd ? 'js/[name].[hash].js' : 'js/[name].js',
          assetFileNames: (assetInfo) => {
            const ext = assetInfo.name.split('.')[assetInfo.name.split('.').length - 1];
            if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
              return `img/[name].[hash][extname]`;
            } else if (['woff', 'woff2', 'eot', 'ttf', 'otf'].includes(ext)) {
              return `fonts/[name].[hash][extname]`;
            }
            return `[name].[hash][extname]`;
          },
        },
      },

      chunkSizeWarningLimit: 1000,
      reportCompressedSize: isProd,
      
      cssCodeSplit: true,
      cssMinify: isProd ? 'esbuild' : false,
    },

    logLevel: isProd ? 'warn' : 'info',
  };
});
