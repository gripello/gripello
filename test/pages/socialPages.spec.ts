import { readFileSync } from 'node:fs'
import path from 'node:path'

const page = (name: string) =>
    readFileSync(
        path.resolve(import.meta.dirname, `../../app/pages/${name}.vue`),
        'utf8',
    )

describe('social pages', () => {
    it('remounts the climber page when only the id changes', () => {
        expect(page('climber')).toMatch(
            /key: \(route\) => String\(route\.query\.id \?\? ''\)/,
        )
    })

    it('keys my comparison sends by the viewed climber', () => {
        expect(page('climber')).toContain('`climber-compare-mine:${climberId}`')
    })

    it('refreshes contributions only when the logbook comes back', () => {
        const timeline = readFileSync(
            path.resolve(
                import.meta.dirname,
                '../../app/components/logbook/Timeline.vue',
            ),
            'utf8',
        )
        expect(timeline).toMatch(
            /onActivated\(\(\) => \{\s+if \(activated\) refreshContributions\(\)/,
        )
    })

    it('shows an error instead of empty stats when sends fail to load', () => {
        const source = page('climber')
        expect(source).toMatch(/error: theirTicksError/)
        expect(source).toMatch(/error: myTicksError/)
        expect(source).toContain(
            '<LayoutLoadError v-else-if="ticksError" @retry="retryTicks" />',
        )
        expect(source).toContain(
            'const retryTicks = () => Promise.all([refreshTheirs(), refreshMine()])',
        )
    })

    it('tells a rate-limited follow apart from a generic failure', () => {
        expect(page('climber')).toContain(
            "notifyError(t(requestErrorKey(error, 'notifications.error.generic')))",
        )
    })

    it.each(['friends', '[gym]/feed'])(
        '%s leaves realtime to the cache plugin',
        (name) => {
            const source = page(name)
            expect(source).not.toMatch(/\.subscribe\(/)
            expect(source).toMatch(/cacheKeys\.(friendsFeed|communityFeed)/)
        },
    )

    it('revokes replaced and abandoned image previews', () => {
        const source = page('account/settings')
        expect(source).toMatch(
            /watch\(avatarPreview, \(_, previous\) => revokeBlobUrl\(previous\)\)/,
        )
        expect(source).toMatch(
            /watch\(bannerPreview, \(_, previous\) => revokeBlobUrl\(previous\)\)/,
        )
        expect(source).toMatch(/onBeforeUnmount\(\(\) => \{\s+revokeBlobUrl/)
    })

    it('shows a load error in the moderation inbox instead of an empty list', () => {
        const inbox = readFileSync(
            path.resolve(
                import.meta.dirname,
                '../../app/components/moderation/Inbox.vue',
            ),
            'utf8',
        )
        expect(inbox).toMatch(/v-if="error"\s+variant="error"/)
    })

    it('offers exactly the moderation actions the server lists for the case', () => {
        const inbox = readFileSync(
            path.resolve(
                import.meta.dirname,
                '../../app/components/moderation/Inbox.vue',
            ),
            'utf8',
        )
        const actionBindings = inbox.match(/:actions="[^"]+"/g) ?? []
        expect(actionBindings.length).toBeGreaterThan(0)
        for (const binding of actionBindings)
            expect(binding).toBe(':actions="selected.actions ?? []"')
        expect(inbox).not.toMatch(/moderationActions|can\('manage_comments'/)
    })

    it('ignores a second follow action while one is running', () => {
        const source = page('friends')
        expect(source).toMatch(/busy\.value = id/)
        expect(source).toMatch(/if \(busy\.value\) return\n\s+busy\.value = id/)
        expect(source).toMatch(
            /:loading="busy === request\.id"\s+data-testid="friends-decline"/,
        )
    })

    it('keeps the feed title in the current language', () => {
        expect(page('[gym]/feed')).toContain(
            "useHead({ title: () => t('page.title.feed') })",
        )
    })
})
