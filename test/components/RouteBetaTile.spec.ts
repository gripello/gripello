import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import RouteBetaTile from '~/components/route/BetaTile.vue'

beforeEach(() => {
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useI18n', () => ({
        t: (key: string, params?: Record<string, string>) =>
            params ? `${key}:${JSON.stringify(params)}` : key,
        locale: ref('en'),
    }))
    vi.stubGlobal('useHydrated', () => ref(true))
})

function mountTile(video: Record<string, unknown>, deletable = false) {
    return mount(RouteBetaTile, {
        props: {
            video: { id: 'b1', created: new Date().toISOString(), ...video },
            deletable,
        } as never,
        global: {
            stubs: {
                NuxtLink: {
                    props: ['to'],
                    template: '<a v-bind="$attrs" :href="to"><slot /></a>',
                },
                ClimberAvatar: true,
                UIcon: true,
                UButton: {
                    emits: ['click'],
                    template:
                        '<button v-bind="$attrs" @click="$emit(\'click\')" />',
                },
                RouteBetaPlayer: {
                    props: ['src'],
                    emits: ['ratio'],
                    template: '<video data-testid="player" :src="src" />',
                },
            },
        },
    })
}

describe('RouteBetaTile', () => {
    it('reports other climbers betas and deletes your own', async () => {
        const other = mountTile({ url: 'https://www.tiktok.com/@a/video/1' })
        expect(other.find('[data-testid="beta-video-delete"]').exists()).toBe(
            false,
        )
        await other.get('[data-testid="beta-video-report"]').trigger('click')
        expect(other.emitted('report')).toHaveLength(1)

        const own = mountTile(
            { url: 'https://www.tiktok.com/@a/video/1' },
            true,
        )
        expect(own.find('[data-testid="beta-video-report"]').exists()).toBe(
            false,
        )
        await own.get('[data-testid="beta-video-delete"]').trigger('click')
        expect(own.emitted('delete')).toHaveLength(1)
    })

    it('opens links on their platform without embedding them', () => {
        const wrapper = mountTile({ url: 'https://www.tiktok.com/@a/video/1' })
        const link = wrapper.get('[data-testid="beta-video-link"]')
        expect(link.attributes('href')).toBe(
            'https://www.tiktok.com/@a/video/1',
        )
        expect(link.attributes('rel')).toContain('noopener')
        expect(link.text()).toContain('TikTok')
        expect(wrapper.find('[data-testid="player"]').exists()).toBe(false)
    })

    it('plays uploads and sizes the tile to the video', async () => {
        const wrapper = mountTile({ file: 'clip_abc.mp4', route: 'r1' })
        expect(wrapper.find('[data-testid="beta-video-link"]').exists()).toBe(
            false,
        )
        const player = wrapper.getComponent('[data-testid="player"]')
        expect(player.props('src')).toContain('clip_abc.mp4')
        player.vm.$emit('ratio', 1)
        await wrapper.vm.$nextTick()
        expect(wrapper.get('article').attributes('style')).toContain('* 1)')
    })

    it('links the author profile only when the author is known', () => {
        expect(
            mountTile({ url: 'https://www.tiktok.com/@a/video/1' })
                .find('[data-testid="beta-video-author"]')
                .exists(),
        ).toBe(false)
        const wrapper = mountTile({
            url: 'https://www.tiktok.com/@a/video/1',
            author: { id: 'u1', name: 'Alex', avatar: null },
        })
        const author = wrapper.get('[data-testid="beta-video-author"]')
        expect(author.attributes('href')).toBe('/climber?id=u1')
        expect(author.text()).toBe('Alex')
    })
})
