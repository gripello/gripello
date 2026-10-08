import { defineConfig, PluginOption } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

const importMetaFlags: Record<string, string> = {
    'import.meta.dev': '(process.env.NODE_ENV !== "production")',
    'import.meta.server': '(process.server === true)',
    'import.meta.client': '(process.server !== true)',
}

const importMetaPolyfill = (): PluginOption => ({
    name: 'import-meta-polyfill',
    enforce: 'pre',
    transform(code) {
        const hits = Object.keys(importMetaFlags).filter((flag) =>
            code.includes(flag),
        )
        if (!hits.length) {
            return null
        }

        return hits.reduce(
            (out, flag) => out.replaceAll(flag, importMetaFlags[flag]),
            code,
        )
    },
})

export default defineConfig({
    plugins: [vue(), importMetaPolyfill()],
    resolve: {
        alias: {
            '~': path.resolve(import.meta.dirname, 'app'),
            '@': path.resolve(import.meta.dirname, 'app'),
            '#shared': path.resolve(import.meta.dirname, 'shared'),
            '#imports': path.resolve(
                import.meta.dirname,
                'test/__stubs__/imports.ts',
            ),
        },
    },
    test: {
        environment: 'happy-dom',
        globals: true,
        setupFiles: ['./test/setup.ts'],
        include: ['test/**/*.spec.ts'],
        exclude: ['e2e/**', 'node_modules/**'],
        coverage: {
            reporter: ['text', 'lcov'],
        },
    },
})
