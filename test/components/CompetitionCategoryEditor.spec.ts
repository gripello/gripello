import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, toRef, watch } from 'vue'
import CompetitionCategoryEditor from '~/components/competition/CategoryEditor.vue'
import {
    createCompetitionCategory,
    deleteCompetitionCategory,
    listCompetitionCategories,
    updateCompetitionCategory,
} from '~/api/competitions'
import { useAsyncAction } from '~/composables/useAsyncAction'

vi.mock('~/api/competitions', () => ({
    createCompetitionCategory: vi.fn(),
    deleteCompetitionCategory: vi.fn(),
    listCompetitionCategories: vi.fn(),
    updateCompetitionCategory: vi.fn(),
}))

const notifyError = vi.fn()
let live: (event: { kind: string }) => void
let stored: Record<string, unknown>[] = []

beforeEach(() => {
    stored = [
        {
            id: 'k1',
            name: 'Youth',
            gender: '',
            min_birth_year: 2010,
            max_birth_year: 0,
        },
    ]
    notifyError.mockReset()
    vi.mocked(listCompetitionCategories)
        .mockReset()
        .mockImplementation(
            async () => stored.map((row) => ({ ...row })) as never,
        )
    vi.mocked(createCompetitionCategory)
        .mockReset()
        .mockImplementation(async (_id, body) => {
            stored.push({ id: 'k2', ...body })
            return { id: 'k2' } as never
        })
    vi.mocked(updateCompetitionCategory)
        .mockReset()
        .mockResolvedValue({} as never)
    vi.mocked(deleteCompetitionCategory)
        .mockReset()
        .mockResolvedValue(undefined as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('toRef', toRef)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useNotification', () => ({
        success: vi.fn(),
        error: notifyError,
    }))
    vi.stubGlobal('useAsyncAction', useAsyncAction)
    vi.stubGlobal(
        'useCompetitionLive',
        (_id: unknown, handler: typeof live) => (live = handler),
    )
})

const input = (attr: string, cast = '') => ({
    inheritAttrs: false,
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<input :data-testid="$attrs['data-testid']" :value="modelValue"
        @input="$emit('update:modelValue', ${cast || '$event.target.value'})" />`,
    name: attr,
})

async function mountEditor() {
    const wrapper = mount(CompetitionCategoryEditor, {
        props: { competitionId: 'c1' },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                UFormField: { template: '<label><slot /></label>' },
                UInput: input('UInput'),
                USelect: input('USelect'),
                UInputNumber: input(
                    'UInputNumber',
                    'Number($event.target.value)',
                ),
                UButton: {
                    inheritAttrs: false,
                    props: ['disabled'],
                    emits: ['click'],
                    template: `<button :data-testid="$attrs['data-testid']" :disabled="disabled"
                        @click="$emit('click')"><slot /></button>`,
                },
            },
        },
    })
    await flushPromises()
    return wrapper
}

const value = (wrapper: Awaited<ReturnType<typeof mountEditor>>, id: string) =>
    (wrapper.get(`[data-testid="${id}"]`).element as HTMLInputElement).value

describe('CompetitionCategoryEditor', () => {
    it('shows saved categories with any gender and empty open year bounds', async () => {
        const wrapper = await mountEditor()
        expect(value(wrapper, 'competition-category-name-0')).toBe('Youth')
        expect(value(wrapper, 'competition-category-gender-0')).toBe('any')
        expect(value(wrapper, 'competition-category-min-0')).toBe('2010')
        expect(value(wrapper, 'competition-category-max-0')).toBe('')
    })

    it('creates a new category only once it has a name and keeps it after the reload', async () => {
        const wrapper = await mountEditor()
        await wrapper
            .get('[data-testid="competition-category-add"]')
            .trigger('click')
        const save = wrapper.get('[data-testid="competition-category-save-1"]')
        expect(save.attributes()).toHaveProperty('disabled')
        await wrapper
            .get('[data-testid="competition-category-name-1"]')
            .setValue('   ')
        expect(save.attributes()).toHaveProperty('disabled')

        await wrapper
            .get('[data-testid="competition-category-name-1"]')
            .setValue('  Women  ')
        await wrapper
            .get('[data-testid="competition-category-gender-1"]')
            .setValue('female')
        await save.trigger('click')
        await flushPromises()
        expect(createCompetitionCategory).toHaveBeenCalledWith('c1', {
            name: 'Women',
            gender: 'female',
            min_birth_year: 0,
            max_birth_year: 0,
            sort: 2,
        })
        expect(wrapper.emitted('changed')).toHaveLength(1)
        expect(
            wrapper.findAll('[data-testid^="competition-category-name-"]'),
        ).toHaveLength(2)

        await wrapper
            .get('[data-testid="competition-category-save-1"]')
            .trigger('click')
        await flushPromises()
        expect(createCompetitionCategory).toHaveBeenCalledOnce()
        expect(updateCompetitionCategory).toHaveBeenCalledWith(
            'k2',
            expect.objectContaining({ name: 'Women' }),
        )
    })

    it('updates an existing category with any gender sent as empty', async () => {
        const wrapper = await mountEditor()
        await wrapper
            .get('[data-testid="competition-category-max-0"]')
            .setValue('2014')
        await wrapper
            .get('[data-testid="competition-category-save-0"]')
            .trigger('click')
        await flushPromises()
        expect(updateCompetitionCategory).toHaveBeenCalledWith('k1', {
            name: 'Youth',
            gender: '',
            min_birth_year: 2010,
            max_birth_year: 2014,
            sort: 1,
        })
    })

    it('drops an unsaved row locally and refuses deleting a category in use', async () => {
        const wrapper = await mountEditor()
        await wrapper
            .get('[data-testid="competition-category-add"]')
            .trigger('click')
        await wrapper
            .get('[data-testid="competition-category-delete-1"]')
            .trigger('click')
        expect(deleteCompetitionCategory).not.toHaveBeenCalled()
        expect(
            wrapper.findAll('[data-testid^="competition-category-name-"]'),
        ).toHaveLength(1)

        vi.mocked(deleteCompetitionCategory).mockRejectedValue(new Error('409'))
        await wrapper
            .get('[data-testid="competition-category-delete-0"]')
            .trigger('click')
        await flushPromises()
        expect(deleteCompetitionCategory).toHaveBeenCalledWith('k1')
        expect(notifyError).toHaveBeenCalledWith('competitions.categoryInUse')
        expect(wrapper.emitted('changed')).toBeUndefined()
        expect(value(wrapper, 'competition-category-name-0')).toBe('Youth')
    })

    it('takes remote changes without losing a local edit or a new row', async () => {
        const wrapper = await mountEditor()
        await wrapper
            .get('[data-testid="competition-category-name-0"]')
            .setValue('Juniors')
        await wrapper
            .get('[data-testid="competition-category-add"]')
            .trigger('click')
        stored.push({
            id: 'k3',
            name: 'Masters',
            gender: 'male',
            min_birth_year: 0,
            max_birth_year: 1975,
        })
        live({ kind: 'entries' })
        await flushPromises()
        expect(
            wrapper.findAll('[data-testid^="competition-category-name-"]'),
        ).toHaveLength(2)

        live({ kind: 'categories' })
        await flushPromises()
        expect(value(wrapper, 'competition-category-name-0')).toBe('Juniors')
        expect(value(wrapper, 'competition-category-name-1')).toBe('Masters')
        expect(value(wrapper, 'competition-category-name-2')).toBe('')
    })
})
