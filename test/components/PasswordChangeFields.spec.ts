import { computed, watch } from 'vue'
import { mount } from '@vue/test-utils'
import PasswordChangeFields from '~/components/user/PasswordChangeFields.vue'

vi.stubGlobal('computed', computed)
vi.stubGlobal('watch', watch)

const STRONG_PASSWORD = 'SecurePass1!'

const simpleStub = { template: '<div />' }

function createWrapper(props: Record<string, unknown> = {}) {
    return mount(PasswordChangeFields, {
        props: {
            oldPassword: '',
            password: '',
            passwordConfirm: '',
            requireOldPassword: true,
            ...props,
        },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                UserPasswordField: simpleStub,
                UIcon: simpleStub,
                Transition: false,
            },
        },
    })
}

describe('PasswordChangeFields – validity emit', () => {
    it('emits validity=false on mount when all fields are empty', () => {
        const wrapper = createWrapper({ requireOldPassword: false })

        expect(wrapper.emitted('validity')).toBeDefined()
        expect(wrapper.emitted('validity')![0]).toEqual([false])
    })

    it('emits validity=true with a strong matching password (reset flow)', () => {
        const wrapper = createWrapper({
            requireOldPassword: false,
            password: STRONG_PASSWORD,
            passwordConfirm: STRONG_PASSWORD,
        })

        const emits = wrapper.emitted('validity')!
        expect(emits[emits.length - 1]).toEqual([true])
    })

    it("accepts passwords far past bcrypt's 72 bytes", () => {
        const long = STRONG_PASSWORD + 'ü'.repeat(200)
        const wrapper = createWrapper({
            requireOldPassword: false,
            password: long,
            passwordConfirm: long,
        })

        const emits = wrapper.emitted('validity')!
        expect(emits[emits.length - 1]).toEqual([true])
    })

    it('counts the minimum in characters, not UTF-16 units', () => {
        const emoji = 'Aa1!😀😀😀'
        const wrapper = createWrapper({
            requireOldPassword: false,
            password: emoji,
            passwordConfirm: emoji,
        })

        const emits = wrapper.emitted('validity')!
        expect(emits[emits.length - 1]).toEqual([false])
    })

    it('emits validity=false when passwords do not match', () => {
        const wrapper = createWrapper({
            requireOldPassword: false,
            password: STRONG_PASSWORD,
            passwordConfirm: STRONG_PASSWORD + 'x',
        })

        const emits = wrapper.emitted('validity')!
        expect(emits[emits.length - 1]).toEqual([false])
    })

    it('emits validity=false when password is too short', () => {
        const wrapper = createWrapper({
            requireOldPassword: false,
            password: 'Sh0rt!',
            passwordConfirm: 'Sh0rt!',
        })

        const emits = wrapper.emitted('validity')!
        expect(emits[emits.length - 1]).toEqual([false])
    })

    it('accepts a passphrase without uppercase, digits or symbols', () => {
        const phrase = 'correct horse battery staple'
        const wrapper = createWrapper({
            requireOldPassword: false,
            password: phrase,
            passwordConfirm: phrase,
        })

        const emits = wrapper.emitted('validity')!
        expect(emits[emits.length - 1]).toEqual([true])
    })

    it('rejects 7 characters', () => {
        const wrapper = createWrapper({
            requireOldPassword: false,
            password: 'abcdefg',
            passwordConfirm: 'abcdefg',
        })

        const emits = wrapper.emitted('validity')!
        expect(emits[emits.length - 1]).toEqual([false])
    })

    it('rates a long passphrase strong', () => {
        const wrapper = createWrapper({
            requireOldPassword: false,
            password: 'correct horse battery staple',
        })

        expect(wrapper.text()).toContain('account.strength.strong')
    })

    it('rates a short single-class password below good', () => {
        const wrapper = createWrapper({
            requireOldPassword: false,
            password: 'onlylower',
        })

        expect(wrapper.text()).toContain('account.strength.fair')
    })

    it('emits validity=false in change flow when old password is empty', () => {
        const wrapper = createWrapper({
            requireOldPassword: true,
            oldPassword: '',
            password: STRONG_PASSWORD,
            passwordConfirm: STRONG_PASSWORD,
        })

        const emits = wrapper.emitted('validity')!
        expect(emits[emits.length - 1]).toEqual([false])
    })

    it('emits validity=true in change flow when all fields are provided and valid', () => {
        const wrapper = createWrapper({
            requireOldPassword: true,
            oldPassword: 'anything',
            password: STRONG_PASSWORD,
            passwordConfirm: STRONG_PASSWORD,
        })

        const emits = wrapper.emitted('validity')!
        expect(emits[emits.length - 1]).toEqual([true])
    })

    it('re-emits validity when props change', async () => {
        const wrapper = createWrapper({
            requireOldPassword: false,
            password: STRONG_PASSWORD,
            passwordConfirm: STRONG_PASSWORD,
        })

        await wrapper.setProps({ passwordConfirm: 'wrongpassword' })

        const emits = wrapper.emitted('validity')!
        expect(emits[emits.length - 1]).toEqual([false])
    })
})
