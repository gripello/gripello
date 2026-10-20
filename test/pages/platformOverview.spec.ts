import { readFileSync } from 'node:fs'

const read = (file: string) => readFileSync(file, 'utf8')

describe('platform overview', () => {
    const overview = read('app/pages/platform/index.vue')

    it('keeps the room of the traffic chart while the client loads it', () => {
        expect(overview).toMatch(
            /<PlatformTrafficChart[\s\S]+?\/>\s+<USkeleton v-else class="h-\[220px\] w-full" \/>/,
        )
        expect(read('app/components/platform/TrafficChart.vue')).toContain(
            ':height="220"',
        )
    })

    it('shows skeletons in every section filled from the traffic request', () => {
        for (const testid of [
            'platform-people',
            'platform-servers',
            'platform-system',
        ])
            expect(overview).toMatch(
                new RegExp(`:loading="trafficLoading"\\s+testid="${testid}"`),
            )
        expect(overview).toMatch(
            /<PlatformEndpointTable[^>]+:loading="trafficLoading"/,
        )
    })
})

describe('platform more page', () => {
    it('ranks its group labels directly below the page title', () => {
        const more = read('app/pages/platform/more.vue')
        expect(more.match(/<LayoutEyebrow\b[^>]*>/g)).toEqual([
            '<LayoutEyebrow as="h2">',
            '<LayoutEyebrow as="h2">',
        ])
    })
})

describe('privacy editor', () => {
    it.each([
        'app/components/admin/GymSettingsForm.vue',
        'app/pages/platform/settings.vue',
    ])('%s loads the editor only when the privacy section opens', (file) => {
        const source = read(file)
        expect(source).toContain('<LazySettingsPrivacyEditor')
        expect(source).not.toMatch(/<SettingsPrivacyEditor\b/)
    })
})
