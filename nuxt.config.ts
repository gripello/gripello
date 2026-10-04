import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './app/utils/locales'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2026-09-26',
    future: {
        compatibilityVersion: 5,
    },
    devtools: {
        enabled: true,
        timeline: {
            enabled: true,
        },
    },
    runtimeConfig: {
        github: {
            owner: process.env.GITHUB_OWNER || 'gripello',
            repo: process.env.GITHUB_REPO || 'gripello',
            branch: process.env.GITHUB_BRANCH || 'main',
        },
        public: {
            repoUrl: `https://github.com/${process.env.GITHUB_OWNER || 'gripello'}/${process.env.GITHUB_REPO || 'gripello'}`,
            appVersion:
                process.env.APP_VERSION ||
                process.env.npm_package_version ||
                'dev',
        },
    },
    ssr: true,
    routeRules: {
        '/logbook': { ssr: false },
    },
    experimental: {
        viewTransition: true,
    },
    nitro: {
        compressPublicAssets: { gzip: true, brotli: true },
    },
    app: {
        head: {
            viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
            meta: [
                { name: 'mobile-web-app-capable', content: 'yes' },
                { name: 'apple-mobile-web-app-title', content: 'Gripello' },
                {
                    name: 'apple-mobile-web-app-status-bar-style',
                    content: 'black-translucent',
                },
            ],
            link: [
                { rel: 'manifest', href: '/manifest.webmanifest' },
                { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
            ],
        },
    },
    modules: ['@nuxt/ui', '@nuxtjs/i18n'],
    css: ['~/assets/css/main.css'],
    ui: {
        fonts: false,
    },
    postcss: {
        plugins: {
            './postcss/sfc-layer.ts': {},
        },
    },
    colorMode: {
        preference: 'system',
        fallback: 'light',
        storage: 'cookie',
        storageKey: 'theme-mode',
    },
    icon: {
        clientBundle: {
            scan: { globInclude: ['app/**/*.{vue,ts}'] },
        },
    },
    i18n: {
        strategy: 'no_prefix',
        lazy: true,
        langDir: 'locales/',
        defaultLocale: DEFAULT_LOCALE,
        detectBrowserLanguage: {
            useCookie: false,
        },
        vueI18n: './i18n.config.ts',
        locales: SUPPORTED_LOCALES.map(({ code, name }) => ({
            code,
            name,
            file: `${code}.ts`,
        })),
    },
    imports: {
        autoImport: true,
    },
    vite: {
        build: {
            minify: 'esbuild',
        },
        optimizeDeps: {
            include: [
                'pocketbase',
                'echarts/core',
                'echarts/charts',
                'echarts/components',
                'echarts/renderers',
                '@vue/devtools-core',
                '@vue/devtools-kit',
            ],
        },
    },
})
