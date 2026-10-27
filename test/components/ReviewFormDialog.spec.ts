import { mount } from '@vue/test-utils'
import { computed, reactive, ref, watch } from 'vue'
import ReviewFormDialog from '~/components/review/FormDialog.vue'
import { createRating, updateRating } from '~/api/ratings'
import { dialogShellStub } from '../__stubs__/dialogShell'

vi.mock('~/api/ratings', () => ({
    createRating: vi.fn(),
    updateRating: vi.fn(),
}))

beforeEach(() => {
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
    vi.stubGlobal('useNotification', () => ({ error: notifyError }))
    vi.stubGlobal('useCapToken', () => ({ capHeaders: vi.fn() }))
    vi.stubGlobal('useNuxtApp', () => ({ $realtimeCache: realtimeCache }))
    vi.stubGlobal('useCurrentGymId', () => computed(() => 'g1'))
})

const realtimeCache = { applyRating: vi.fn(), revertRating: vi.fn() }
const notifyError = vi.fn()
const setErrors = vi.fn()

async function openDialog(
    routeGrade: string | null,
    review: Record<string, unknown> | null = null,
) {
    const wrapper = mount(ReviewFormDialog, {
        props: {
            modelValue: false,
            routeId: 'r1',
            gradeSystem: 'uiaa',
            routeGrade,
            review: review as never,
        },
        global: {
            mocks: { $t: (key: string) => key },
            stubs: {
                LayoutDialogShell: dialogShellStub,
                UForm: {
                    setup(
                        _: unknown,
                        { expose }: { expose: (exposed: object) => void },
                    ) {
                        expose({ setErrors })
                    },
                    template: '<form><slot /></form>',
                },
                ClimberAvatar: true,
                UButton: {
                    props: ['disabled'],
                    emits: ['click'],
                    template:
                        '<button @click="$emit(\'click\')"><slot /></button>',
                },
                SegmentedControl: {
                    name: 'SegmentedControl',
                    props: ['modelValue', 'items'],
                    template: '<div />',
                },
                UInputRating: {
                    name: 'UInputRating',
                    props: ['modelValue'],
                    template: '<div />',
                },
                UTextarea: {
                    props: ['modelValue'],
                    emits: ['update:modelValue'],
                    template:
                        '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
                },
                USelectMenu: {
                    name: 'USelectMenu',
                    props: ['modelValue', 'items'],
                    template: '<div />',
                },
            },
        },
    })
    await wrapper.setProps({ modelValue: true })
    return wrapper
}

describe('ReviewFormDialog', () => {
    it('offers two grades either side of the route grade, starting on it', async () => {
        const wrapper = await openDialog('5')

        const grades = wrapper.getComponent({ name: 'SegmentedControl' })
        expect(
            grades.props('items').map(({ value }: { value: string }) => value),
        ).toEqual(['4+', '5-', '5', '5+', '6-'])
        expect(grades.props('modelValue')).toBe('5')
    })

    it('keeps the picked grade', async () => {
        const wrapper = await openDialog('5')

        const grades = wrapper.getComponent({ name: 'SegmentedControl' })
        grades.vm.$emit('update:modelValue', '6-')
        await wrapper.vm.$nextTick()

        expect(grades.props('modelValue')).toBe('6-')
    })

    it('falls back to every grade when the route grade is unknown', async () => {
        const wrapper = await openDialog(null)

        expect(
            wrapper.findComponent({ name: 'SegmentedControl' }).exists(),
        ).toBe(false)
        const select = wrapper.getComponent({ name: 'USelectMenu' })
        expect(select.props('items')).toContain('9+')
        expect(select.props('modelValue')).toBeNull()
    })

    it('treats a cleared star rating as no rating', async () => {
        const wrapper = await openDialog('5')

        const stars = wrapper.getComponent({ name: 'UInputRating' })
        stars.vm.$emit('update:modelValue', 4)
        await wrapper.vm.$nextTick()
        expect(stars.props('modelValue')).toBe(4)

        stars.vm.$emit('update:modelValue', 0)
        await wrapper.vm.$nextTick()
        expect(stars.props('modelValue')).toBeUndefined()
    })

    it('shows a complete optimistic review and posts only the review fields', async () => {
        vi.mocked(createRating).mockResolvedValue({ id: 'saved' } as never)
        const wrapper = await openDialog('5')
        wrapper
            .getComponent({ name: 'UInputRating' })
            .vm.$emit('update:modelValue', 4)
        await wrapper.get('textarea').setValue('Good')

        await wrapper.get('[data-testid="review-form-submit"]').trigger('click')

        const optimistic = realtimeCache.applyRating.mock.calls[0]![0]
        expect(optimistic).toMatchObject({
            gym: 'g1',
            route_id: 'r1',
            rating: 4,
            grade: '5',
            grade_system: 'uiaa',
            comment: 'Good',
        })
        expect(optimistic.created).toBe(optimistic.updated)
        await vi.waitFor(() => expect(createRating).toHaveBeenCalled())
        const [routeId, input] = vi.mocked(createRating).mock.calls[0]!
        expect(routeId).toBe('r1')
        expect(Object.keys(input).sort()).toEqual([
            'comment',
            'grade',
            'grade_index',
            'grade_system',
            'rating',
        ])
    })

    it('names the star picker', async () => {
        const wrapper = await openDialog('5')

        expect(
            wrapper
                .getComponent({ name: 'UInputRating' })
                .attributes('aria-label'),
        ).toBe('ratings.stars')
    })

    it('keeps the dialog and the typed review when saving fails, then saves once', async () => {
        vi.mocked(createRating).mockReset()
        let fail!: (error: unknown) => void
        vi.mocked(createRating).mockImplementationOnce(
            () => new Promise((_, reject) => (fail = reject)),
        )
        const wrapper = await openDialog('5')
        wrapper
            .getComponent({ name: 'UInputRating' })
            .vm.$emit('update:modelValue', 4)
        await wrapper.get('textarea').setValue('Great crimps')
        const submit = wrapper.get('[data-testid="review-form-submit"]')

        await submit.trigger('click')
        await submit.trigger('click')
        await vi.waitFor(() => expect(fail).toBeTypeOf('function'))
        fail(Object.assign(new Error('boom'), { status: 500 }))
        await vi.waitFor(() => expect(notifyError).toHaveBeenCalled())

        expect(createRating).toHaveBeenCalledTimes(1)
        expect(realtimeCache.revertRating).toHaveBeenCalled()
        expect(wrapper.emitted('update:modelValue')).toBeUndefined()
        expect(
            (wrapper.get('textarea').element as HTMLTextAreaElement).value,
        ).toBe('Great crimps')

        vi.mocked(createRating).mockResolvedValueOnce({ id: 'saved' } as never)
        await submit.trigger('click')
        await vi.waitFor(() =>
            expect(wrapper.emitted('update:modelValue')).toEqual([[false]]),
        )
        expect(createRating).toHaveBeenCalledTimes(2)
    })

    it('tells a climber who already reviewed the route to edit that review', async () => {
        vi.mocked(createRating).mockReset()
        setErrors.mockReset()
        notifyError.mockReset()
        vi.mocked(createRating).mockRejectedValueOnce(
            Object.assign(new Error('conflict'), {
                status: 409,
                response: {
                    data: { rating: { code: 'validation_already_reviewed' } },
                },
            }),
        )
        const wrapper = await openDialog('5')
        wrapper
            .getComponent({ name: 'UInputRating' })
            .vm.$emit('update:modelValue', 4)
        await wrapper.get('textarea').setValue('Again')
        await wrapper.get('[data-testid="review-form-submit"]').trigger('click')
        await vi.waitFor(() =>
            expect(notifyError).toHaveBeenCalledWith('ratings.alreadyReviewed'),
        )
        expect(setErrors).not.toHaveBeenCalled()
        expect(realtimeCache.revertRating).toHaveBeenCalled()
        expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    })

    it('maps server field errors onto the form and emits saved only after success', async () => {
        vi.mocked(createRating).mockReset()
        setErrors.mockReset()
        notifyError.mockReset()
        vi.mocked(createRating).mockRejectedValueOnce(
            Object.assign(new Error('invalid'), {
                status: 400,
                response: {
                    data: { comment: { code: 'validation_required' } },
                },
            }),
        )
        const wrapper = await openDialog('5')
        wrapper
            .getComponent({ name: 'UInputRating' })
            .vm.$emit('update:modelValue', 4)
        await wrapper.get('textarea').setValue('Nice')
        const submit = wrapper.get('[data-testid="review-form-submit"]')

        await submit.trigger('click')
        await vi.waitFor(() => expect(setErrors).toHaveBeenCalled())
        expect(setErrors).toHaveBeenCalledWith([
            { name: 'comment', message: 'validation.required' },
        ])
        expect(notifyError).not.toHaveBeenCalled()
        expect(wrapper.emitted('saved')).toBeUndefined()
        expect(wrapper.emitted('update:modelValue')).toBeUndefined()

        vi.mocked(createRating).mockResolvedValueOnce({ id: 'saved' } as never)
        await submit.trigger('click')
        await vi.waitFor(() =>
            expect(wrapper.emitted('saved')).toEqual([[{ id: 'saved' }]]),
        )
    })

    it('lets the author edit their own review under the create rules and sends it cleaned', async () => {
        vi.mocked(updateRating).mockReset()
        vi.mocked(updateRating).mockResolvedValueOnce({ id: 'rev1' } as never)
        const wrapper = await openDialog('5', {
            id: 'rev1',
            mine: true,
            rating: 3,
            grade: '5',
            comment: 'Old',
            grade_system: 'uiaa',
        })
        expect(wrapper.find('.review-form__context').exists()).toBe(false)
        await wrapper.get('textarea').setValue('  Better  ')
        await wrapper.get('[data-testid="review-form-submit"]').trigger('click')
        await vi.waitFor(() => expect(updateRating).toHaveBeenCalled())
        expect(updateRating).toHaveBeenCalledWith(
            'rev1',
            expect.objectContaining({ rating: 3, comment: 'Better' }),
        )
    })

    it('asks for a captcha only for new reviews and saves edits once', async () => {
        expect(
            (await openDialog('5'))
                .getComponent(dialogShellStub)
                .props('captcha'),
        ).toBe(true)

        let finish!: (value: unknown) => void
        vi.mocked(updateRating).mockImplementationOnce(
            () => new Promise((resolve) => (finish = resolve)),
        )
        const wrapper = await openDialog('5', {
            id: 'rev1',
            rating: 3,
            grade: '5',
            comment: 'Old',
            grade_system: 'uiaa',
        })
        expect(wrapper.getComponent(dialogShellStub).props('captcha')).toBe(
            false,
        )
        const submit = wrapper.get('[data-testid="review-form-submit"]')
        await submit.trigger('click')
        await submit.trigger('click')
        expect(updateRating).toHaveBeenCalledTimes(1)
        expect(wrapper.emitted('saved')).toBeUndefined()
        finish({ id: 'rev1' })
        await vi.waitFor(() =>
            expect(wrapper.emitted('saved')).toEqual([[{ id: 'rev1' }]]),
        )
    })
})
