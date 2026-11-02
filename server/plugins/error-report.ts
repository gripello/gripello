import { reportServerError } from '../utils/serverErrors'

export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('error', (error, { event }) =>
        reportServerError(error, event),
    )
})
