export function useSectionQuery(key: string) {
    const route = useRoute()
    const router = useRouter()

    function select(section: string) {
        return navigateTo(
            { query: { [key]: section } },
            { replace: !!route.query[key] },
        )
    }

    function backToList() {
        const previous = window.history.state?.back
        if (typeof previous === 'string') {
            const target = router.resolve(previous)
            if (target.path === route.path && !target.query[key])
                return router.back()
        }
        return navigateTo({ query: {} }, { replace: true })
    }

    return { select, backToList }
}
