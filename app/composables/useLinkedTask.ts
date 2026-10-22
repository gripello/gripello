import type { Ref } from 'vue'
import { getTask } from '~/api/tasks'
import type { TaskRecord } from '~/types/models'

export function useLinkedTask(
    gymId: Ref<string>,
    dialogOpen: Ref<boolean>,
    open: (task: TaskRecord) => void,
) {
    const route = useRoute()
    const router = useRouter()

    async function openLinked(id: unknown) {
        if (typeof id !== 'string' || !id) return
        const task = await getTask(id).catch(() => null)
        if (task?.gym === gymId.value) open(task)
    }

    onMounted(() => void openLinked(route.query.task))
    // Nuxt keeps the page when only the query changes (notification link).
    watch(
        () => route.query.task,
        (id) => void openLinked(id),
    )
    // A closed dialog drops the link, so the same notification opens it again.
    watch(dialogOpen, (isOpen) => {
        if (isOpen || !route.query.task) return
        const { task: _closed, ...query } = route.query
        void router.replace({ query })
    })
}
