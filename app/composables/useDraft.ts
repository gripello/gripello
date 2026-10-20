import {
    computed,
    isReadonly,
    isRef,
    reactive,
    shallowRef,
    toValue,
    watch,
} from 'vue'
import type { Ref } from 'vue'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function useDraft<S, F extends Record<string, unknown>>(
    source: Ref<S> | (() => S),
    formFrom: (source: S) => F,
) {
    const base = shallowRef(toValue(source))
    const pristine = computed(() => formFrom(base.value))
    const form = reactive(formFrom(base.value)) as F

    watch(
        () => toValue(source),
        (next) => {
            const before = pristine.value
            base.value = next
            const fresh = formFrom(next)
            for (const key of Object.keys(fresh) as (keyof F)[])
                if (same(form[key], before[key])) form[key] = fresh[key]
        },
    )

    const hasChanges = computed(() => !same(form, pristine.value))

    function reset() {
        Object.assign(form, formFrom(base.value))
    }

    function commit(saved?: S) {
        if (saved !== undefined) {
            base.value = saved
            if (isRef(source) && !isReadonly(source)) source.value = saved
        }
        reset()
    }

    return { form, pristine, hasChanges, reset, commit }
}
