import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'https://localhost'

const SETTINGS_WRITERS = [
    '**/admin/settings.spec.ts',
    '**/admin/platform-settings.spec.ts',
    '**/auth/guest-register-link.spec.ts',
    '**/mail/register.spec.ts',
]

export default defineConfig({
    testDir: './e2e/specs',
    outputDir: './e2e/results/artifacts',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 4 : undefined,
    reporter: process.env.CI
        ? [
              ['list'],
              ['junit', { outputFile: 'e2e/results/junit.xml' }],
              ['html', { outputFolder: 'e2e/results/html', open: 'never' }],
              ['./e2e/support/flaky-reporter.ts'],
          ]
        : 'list',
    globalSetup: './e2e/support/global-setup.ts',
    globalTeardown: './e2e/support/global-teardown.ts',
    use: {
        baseURL,
        ignoreHTTPSErrors: true,
        serviceWorkers: 'block',
        actionTimeout: 15_000,
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'setup',
            testMatch: /^$/,
            teardown: 'settings-serial',
        },
        {
            name: 'desktop-en',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1440, height: 900 },
                locale: 'en-US',
            },
            dependencies: ['setup'],
            testIgnore: ['**/i18n/**', '**/mobile/**', ...SETTINGS_WRITERS],
        },
        {
            name: 'mobile-en',
            use: {
                ...devices['Pixel 7'],
                locale: 'en-US',
            },
            dependencies: ['setup'],
            testMatch: ['**/mobile/**', '**/auth/**'],
            testIgnore: ['**/auth/guards.spec.ts', ...SETTINGS_WRITERS],
        },
        {
            name: 'i18n-de',
            use: { ...devices['Desktop Chrome'], locale: 'de-DE' },
            dependencies: ['setup'],
            testMatch: ['**/i18n/**'],
        },
        {
            name: 'i18n-nl',
            use: { ...devices['Desktop Chrome'], locale: 'nl-NL' },
            dependencies: ['setup'],
            testMatch: ['**/i18n/**'],
        },
        {
            name: 'i18n-fr',
            use: { ...devices['Desktop Chrome'], locale: 'fr-FR' },
            dependencies: ['setup'],
            testMatch: ['**/i18n/**'],
        },
        {
            name: 'i18n-es',
            use: { ...devices['Desktop Chrome'], locale: 'es-ES' },
            dependencies: ['setup'],
            testMatch: ['**/i18n/**'],
        },
        {
            name: 'firefox-smoke',
            use: { ...devices['Desktop Firefox'], locale: 'en-US' },
            dependencies: ['setup'],
            testMatch: ['**/auth/**', '**/public/index-list.spec.ts'],
            testIgnore: ['**/auth/guards.spec.ts', ...SETTINGS_WRITERS],
        },
        {
            name: 'webkit-smoke',
            use: { ...devices['Desktop Safari'], locale: 'en-US' },
            dependencies: ['setup'],
            testMatch: ['**/auth/**', '**/public/index-list.spec.ts'],
            testIgnore: ['**/auth/guards.spec.ts', ...SETTINGS_WRITERS],
        },
        {
            name: 'settings-serial',
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1440, height: 900 },
                locale: 'en-US',
            },
            testMatch: SETTINGS_WRITERS,
            fullyParallel: false,
            workers: 1,
        },
    ],
})
