import { endedSession } from '~/utils/errors'

export function useSessionEnded() {
    const { t } = useI18n()
    const { notify } = useNotification()

    return function noticeSessionEnded(error: unknown) {
        if (!endedSession(error)) return false
        notify(
            t('errors.sessionEnded'),
            'warning',
            {
                label: t('routes.login'),
                onClick: () =>
                    void navigateTo({
                        path: '/auth/login',
                        query: {
                            redirect: `${location.pathname}${location.search}${location.hash}`,
                        },
                    }),
            },
            'session-ended',
        )
        return true
    }
}
