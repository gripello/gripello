import { useAuthState } from '~/api/auth'
import { isNativeApp } from '~/utils/native'
import { connectWidget, widgetPlugin } from '~/utils/widget'

export default defineNuxtPlugin(() => {
    if (!isNativeApp()) return
    connectWidget(widgetPlugin(), useAuthState(), location.origin)
})
