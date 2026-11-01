import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref, watch } from 'vue'
import CompetitionRegistration from '~/components/competition/Registration.vue'
import {
    createCompetitionEntry,
    listCompetitionCategories,
    updateCompetitionEntry,
} from '~/api/competitions'
import { useAsyncAction } from '~/composables/useAsyncAction'

vi.mock('~/api/competitions', () => ({
    createCompetitionEntry: vi.fn(),
    listCompetitionCategories: vi.fn(),
    updateCompetitionEntry: vi.fn(),
}))

const YEAR = new Date().getFullYear()
const success = vi.fn()
const notifyError = vi.fn()
let user: Record<string, unknown> | null = null

const competition = (overrides: Record<string, unknown> = {}) => ({
    id: 'c1',
    status: 'open',
    ends_at: new Date(Date.now() + 86_400_000).toISOString(),
    requires_payment: false,
    registration_url: '',
    ...overrides,
})

const CATEGORIES = [
    { id: 'adults', name: 'Adults', min_birth_year: 0, max_birth_year: 2000 },
    {
        id: 'youth',
        name: 'Youth',
        min_birth_year: YEAR - 15,
        max_birth_year: 0,
    },
]

beforeEach(() => {
    user = { id: 'u1', firstname: 'Ann', name: 'Lee' }
    success.mockReset()
    notifyError.mockReset()
    vi.mocked(createCompetitionEntry)
        .mockReset()
        .mockResolvedValue({} as never)
    vi.mocked(updateCompetitionEntry)
        .mockReset()
        .mockResolvedValue({} as never)
    vi.mocked(listCompetitionCategories)
        .mockReset()
        .mockResolvedValue(CATEGORIES as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useAuthStore', () => ({ record: user }))
    vi.stubGlobal('useGymPath', () => (path: string) => `/gym${path}`)
    vi.stubGlobal('useNotification', () => ({ success, error: notifyError }))
    vi.stubGlobal('useAsyncAction', useAsyncAction)
})

const field = (testId: string) => ({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<input data-testid="${testId}" :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)" />`,
})

async function mountRegistration(
    props: Record<string, unknown> = {},
): Promise<ReturnType<typeof mount>> {
    const wrapper = mount(CompetitionRegistration, {
        props: { competition: competition(), entry: null, ...props } as never,
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutPanel: { template: '<section><slot /></section>' },
                LayoutStatTile: {
                    props: ['value'],
                    template:
                        '<b data-testid="competition-my-bib">{{ value }}</b>',
                },
                AuthGuestCta: {
                    props: ['redirect'],
                    template: '<a data-testid="guest-cta" :href="redirect" />',
                },
                UForm: {
                    props: ['state', 'validate'],
                    emits: ['submit'],
                    data: () => ({ errors: [] as { name: string }[] }),
                    methods: {
                        async submit() {
                            this.errors = await this.validate(this.state)
                            if (!this.errors.length) this.$emit('submit')
                        },
                    },
                    template: `<form @submit.prevent="submit"><slot />
                        <p v-for="e in errors" :key="e.name" :data-error="e.name" /></form>`,
                },
                UFormField: { template: '<div><slot /></div>' },
                UInput: field('competition-register-name'),
                UInputNumber: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input data-testid="competition-register-birth-year"
                        :value="modelValue"
                        @input="$emit('update:modelValue', Number($event.target.value))" />`,
                },
                USelect: {
                    props: ['modelValue', 'items', 'disabled'],
                    emits: ['update:modelValue'],
                    template: `<select data-testid="competition-register-category"
                        :disabled="disabled" :value="modelValue"
                        @change="$emit('update:modelValue', $event.target.value)">
                        <option v-for="i in items" :key="i.value" :value="i.value">{{ i.label }}</option>
                    </select>`,
                },
                USwitch: true,
                UCheckbox: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template: `<input type="checkbox" data-testid="competition-register-consent"
                        :checked="modelValue"
                        @change="$emit('update:modelValue', $event.target.checked)" />`,
                },
                UBadge: {
                    template:
                        '<span data-testid="competition-my-paid"><slot /></span>',
                },
                UButton: {
                    inheritAttrs: false,
                    props: ['type', 'to'],
                    emits: ['click'],
                    template: `<button :type="type ?? 'button'" :data-to="to"
                        :data-testid="$attrs['data-testid']" @click="$emit('click')"><slot /></button>`,
                },
                ConfirmDialog: {
                    props: ['modelValue'],
                    emits: ['confirm'],
                    template:
                        '<button v-if="modelValue" data-testid="withdraw-confirm" @click="$emit(\'confirm\')" />',
                },
            },
        },
    })
    await flushPromises()
    return wrapper
}

const submit = async (wrapper: ReturnType<typeof mount>) => {
    await wrapper.get('form').trigger('submit')
    await flushPromises()
}
const errors = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll('[data-error]').map((e) => e.attributes('data-error'))
const options = (wrapper: ReturnType<typeof mount>) =>
    wrapper
        .findAll('[data-testid="competition-register-category"] option')
        .map((o) => o.text())

describe('CompetitionRegistration', () => {
    it('sends guests to sign in and hides itself once registration is over', async () => {
        user = null
        const guest = await mountRegistration()
        expect(guest.get('[data-testid="guest-cta"]').attributes('href')).toBe(
            '/gym/competitions/c1',
        )
        expect(guest.find('form').exists()).toBe(false)

        const closed = await mountRegistration({
            competition: competition({ status: 'closed' }),
        })
        expect(
            closed.find('[data-testid="competition-registration"]').exists(),
        ).toBe(false)
    })

    it('needs a name, birth year and category before sending', async () => {
        const wrapper = await mountRegistration()
        expect(
            (
                wrapper.get('[data-testid="competition-register-name"]')
                    .element as HTMLInputElement
            ).value,
        ).toBe('Ann Lee')
        await wrapper
            .get('[data-testid="competition-register-name"]')
            .setValue('   ')
        await submit(wrapper)
        expect(errors(wrapper)).toEqual([
            'displayName',
            'birthYear',
            'category',
        ])
        expect(createCompetitionEntry).not.toHaveBeenCalled()
    })

    it('offers only categories for the birth year and picks the only one', async () => {
        const wrapper = await mountRegistration()
        expect(options(wrapper)).toHaveLength(2)

        await wrapper
            .get('[data-testid="competition-register-birth-year"]')
            .setValue('1990')
        await flushPromises()
        expect(options(wrapper)).toEqual(['Adults (≤ 2000)'])
        await wrapper
            .get('[data-testid="competition-register-name"]')
            .setValue('  Ann L.  ')
        await submit(wrapper)

        expect(createCompetitionEntry).toHaveBeenCalledWith('c1', {
            user: 'u1',
            category: 'adults',
            display_name: 'Ann L.',
            birth_year: 1990,
            hidden: false,
            guardian_consent: false,
        })
        expect(wrapper.emitted('changed')).toHaveLength(1)
        expect(success).toHaveBeenCalledWith('competitions.register.done')
    })

    it('requires guardian consent for young climbers and drops it for adults', async () => {
        const wrapper = await mountRegistration()
        expect(
            wrapper
                .find('[data-testid="competition-register-consent"]')
                .exists(),
        ).toBe(false)
        await wrapper
            .get('[data-testid="competition-register-birth-year"]')
            .setValue(String(YEAR - 12))
        await flushPromises()
        await submit(wrapper)
        expect(errors(wrapper)).toEqual(['guardianConsent'])

        await wrapper
            .get('[data-testid="competition-register-consent"]')
            .setValue(true)
        await submit(wrapper)
        expect(createCompetitionEntry).toHaveBeenCalledWith(
            'c1',
            expect.objectContaining({
                category: 'youth',
                guardian_consent: true,
            }),
        )

        await wrapper
            .get('[data-testid="competition-register-birth-year"]')
            .setValue('1990')
        await flushPromises()
        await submit(wrapper)
        expect(createCompetitionEntry).toHaveBeenLastCalledWith(
            'c1',
            expect.objectContaining({
                category: 'adults',
                guardian_consent: false,
            }),
        )
    })

    it('names a protected name and keeps the form when sending fails', async () => {
        vi.mocked(createCompetitionEntry).mockRejectedValue({
            response: {
                data: { display_name: { code: 'validation_name_protected' } },
            },
        })
        const wrapper = await mountRegistration()
        await wrapper
            .get('[data-testid="competition-register-birth-year"]')
            .setValue('1990')
        await flushPromises()
        await submit(wrapper)
        expect(notifyError).toHaveBeenCalledWith('errors.nameProtected')
        expect(wrapper.emitted('changed')).toBeUndefined()
        expect(
            (
                wrapper.get('[data-testid="competition-register-birth-year"]')
                    .element as HTMLInputElement
            ).value,
        ).toBe('1990')

        vi.mocked(createCompetitionEntry).mockRejectedValue(new Error('down'))
        await submit(wrapper)
        expect(notifyError).toHaveBeenLastCalledWith(
            'notifications.error.generic',
        )
    })

    it('shows the own entry with withdraw after a confirm', async () => {
        const wrapper = await mountRegistration({
            competition: competition({
                requires_payment: true,
                registration_url: 'https://pay.example',
            }),
            entry: {
                id: 'e1',
                bib: 7,
                status: 'registered',
                paid: false,
                category: 'adults',
                display_name: 'Ann',
            },
        })
        expect(wrapper.get('[data-testid="competition-my-bib"]').text()).toBe(
            '7',
        )
        expect(wrapper.text()).toContain('Ann · Adults')
        expect(wrapper.get('[data-testid="competition-my-paid"]').text()).toBe(
            'competitions.notPaid',
        )
        expect(
            wrapper
                .get('[data-testid="competition-pay-link"]')
                .attributes('data-to'),
        ).toBe('https://pay.example')

        await wrapper
            .get('[data-testid="competition-withdraw"]')
            .trigger('click')
        expect(updateCompetitionEntry).not.toHaveBeenCalled()
        await wrapper.get('[data-testid="withdraw-confirm"]').trigger('click')
        await flushPromises()
        expect(updateCompetitionEntry).toHaveBeenCalledWith('e1', {
            status: 'withdrawn',
        })
        expect(wrapper.emitted('changed')).toHaveLength(1)
        expect(wrapper.find('[data-testid="withdraw-confirm"]').exists()).toBe(
            false,
        )
    })

    it('lets a withdrawn climber rejoin only while registration is open, and never a disqualified one', async () => {
        const entry = (status: string) => ({
            id: 'e1',
            bib: 7,
            status,
            paid: true,
            category: 'adults',
            display_name: 'Ann',
        })
        const open = await mountRegistration({ entry: entry('withdrawn') })
        await open.get('[data-testid="competition-rejoin"]').trigger('click')
        await flushPromises()
        expect(updateCompetitionEntry).toHaveBeenCalledWith('e1', {
            status: 'registered',
        })

        const ended = await mountRegistration({
            competition: competition({ status: 'closed' }),
            entry: entry('withdrawn'),
        })
        expect(ended.find('[data-testid="competition-rejoin"]').exists()).toBe(
            false,
        )
        expect(
            ended.find('[data-testid="competition-withdraw"]').exists(),
        ).toBe(false)

        const disqualified = await mountRegistration({
            entry: entry('disqualified'),
        })
        expect(
            disqualified.find('[data-testid="competition-withdraw"]').exists(),
        ).toBe(false)
        expect(
            disqualified.find('[data-testid="competition-pay-link"]').exists(),
        ).toBe(false)
    })
})
