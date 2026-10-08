import { useTemplateRef } from 'vue'
import { mount } from '@vue/test-utils'
import ProfileImages from '~/components/user/ProfileImages.vue'
import ClimberBanner from '~/components/climber/Banner.vue'
import ClimberAvatar from '~/components/climber/Avatar.vue'

vi.stubGlobal('useTemplateRef', useTemplateRef)

const cropStub = {
    name: 'ImageCropDialog',
    props: ['file', 'aspect', 'round'],
    emits: ['cropped', 'cancel'],
    template: '<div data-testid="crop" :data-aspect="aspect" />',
}

function mountImages(banner: string | null) {
    return mount(ProfileImages, {
        props: { banner, avatar: null, name: 'Anna Berg' },
        global: {
            components: { ClimberBanner, ClimberAvatar },
            stubs: {
                ImageCropDialog: cropStub,
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

async function choose(
    wrapper: ReturnType<typeof mountImages>,
    id: string,
    type = 'image/png',
) {
    const input = wrapper.get(`[data-testid="${id}"]`)
    const file = new File(['x'], 'a.png', { type })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    return file
}

describe('ProfileImages', () => {
    it('crops banner and avatar before emitting them separately', async () => {
        const wrapper = mountImages(null)
        const crop = () => wrapper.getComponent(cropStub)
        const bannerCrop = new File(['b'], 'b.jpg', { type: 'image/jpeg' })
        const avatarCrop = new File(['a'], 'a.jpg', { type: 'image/jpeg' })

        await choose(wrapper, 'profile-banner-input')
        expect(wrapper.emitted('banner')).toBeUndefined()
        expect(crop().props('aspect')).toBe(4)
        crop().vm.$emit('cropped', bannerCrop)
        await choose(wrapper, 'profile-avatar-input')
        expect(crop().props()).toMatchObject({ aspect: 1, round: true })
        crop().vm.$emit('cropped', avatarCrop)

        expect(wrapper.emitted('banner')).toEqual([[bannerCrop]])
        expect(wrapper.emitted('avatar')).toEqual([[avatarCrop]])
    })

    it('uploads SVG avatars without cropping', async () => {
        const wrapper = mountImages(null)
        const svg = await choose(
            wrapper,
            'profile-avatar-input',
            'image/svg+xml',
        )

        expect(wrapper.emitted('avatar')).toEqual([[svg]])
        expect(wrapper.getComponent(cropStub).props('file')).toBeNull()
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
