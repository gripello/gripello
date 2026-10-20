import { computed, nextTick, ref } from 'vue'
import { useDraft } from '~/composables/useDraft'

const formFrom = (rec: { name: string } | null) => ({ name: rec?.name ?? '' })

describe('useDraft', () => {
    it('adopts remote changes while the form is untouched', async () => {
        const source = ref<{ name: string } | null>(null)
        const { form, hasChanges } = useDraft(source, formFrom)
        source.value = { name: 'remote' }
        await nextTick()
        expect(form.name).toBe('remote')
        expect(hasChanges.value).toBe(false)
    })

    it('keeps unsaved edits when the source reloads', async () => {
        const source = ref({ name: 'a' })
        const { form, hasChanges } = useDraft(source, formFrom)
        form.name = 'edited'
        source.value = { name: 'b' }
        await nextTick()
        expect(form.name).toBe('edited')
        expect(hasChanges.value).toBe(true)
    })

    it('adopts remote changes of the fields nobody touched', async () => {
        const source = ref({ name: 'a', city: 'x' })
        const { form } = useDraft(source, (rec) => ({ ...rec }))
        form.name = 'edited'
        source.value = { name: 'b', city: 'y' }
        await nextTick()
        expect(form).toEqual({ name: 'edited', city: 'y' })
    })

    it('takes a saved record as the new baseline of a read-only source', () => {
        const source = computed(() => ({ name: 'a' }))
        const { form, hasChanges, commit } = useDraft(source, formFrom)
        form.name = 'saved'
        commit({ name: 'saved' })
        expect(hasChanges.value).toBe(false)
    })

    it('resets to the source and commits a saved record', async () => {
        const source = ref({ name: 'a' })
        const { form, hasChanges, reset, commit } = useDraft(source, formFrom)
        form.name = 'edited'
        reset()
        expect(form.name).toBe('a')
        form.name = 'saved'
        commit({ name: 'saved' })
        expect(source.value.name).toBe('saved')
        expect(hasChanges.value).toBe(false)
    })
})
