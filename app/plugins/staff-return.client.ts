import type { RouteLocationNormalized } from 'vue-router'
import { navContext } from '~/utils/navigation'

const isStaff = (route: RouteLocationNormalized) =>
    navContext(route.path, routeGymSlug(route.params)) === 'staff'

export default defineNuxtPlugin(() => {
    const returnTo = useStaffReturnTo()
    useRouter().afterEach((to, from) => {
        if (isStaff(to) && from.matched.length && !isStaff(from))
            returnTo.value = from.fullPath
    })
})
