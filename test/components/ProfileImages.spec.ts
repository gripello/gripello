import { useTemplateRef } from 'vue'
import { mount } from '@vue/test-utils'
import ProfileImages from '~/components/user/ProfileImages.vue'
import ClimberBanner from '~/components/climber/Banner.vue'

vi.stubGlobal('useTemplateRef', useTemplateRef)

function mountImages(banner: string | null) {
    return mount(ProfileImages, {
        props: { banner, avatar: null, name: 'Anna Berg' },
        global: {
            components: { ClimberBanner },
            stubs: {
                UIcon: true,
                UAvatar: { props: ['text'], template: '<i>{{ text }}</i>' },
                UButton: {
                    inheritAttrs: false,
                    template:
                        '<button :data-testid="$attrs[\'data-testid\']" @click="$attrs.onClick" />',
                },
            },
            mocks: { $t: (key: string) => key },
        },
    })
}

async function choose(wrapper: ReturnType<typeof mountImages>, id: string) {
    const input = wrapper.get(`[data-testid="${id}"]`)
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    return file
}

describe('ProfileImages', () => {
    it('emits banner and avatar files separately', async () => {
        const wrapper = mountImages(null)
        const banner = await choose(wrapper, 'profile-banner-input')
        const avatar = await choose(wrapper, 'profile-avatar-input')
        expect(wrapper.emitted('banner')).toEqual([[banner]])
        expect(wrapper.emitted('avatar')).toEqual([[avatar]])
    })

    it('shows initials and offers removal only for a set banner', async () => {
        const empty = mountImages(null)
        expect(empty.text()).toContain('AB')
        expect(
            empty.find('[data-testid="profile-banner-remove"]').exists(),
        ).toBe(false)
        const set = mountImages('blob:banner')
        expect(set.get('img').attributes('src')).toBe('blob:banner')
        await set.get('[data-testid="profile-banner-remove"]').trigger('click')
        expect(set.emitted('removeBanner')).toHaveLength(1)
    })
})
