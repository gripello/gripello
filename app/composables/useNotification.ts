export type NotificationColor = 'success' | 'error' | 'warning' | 'info'

const ICONS: Record<NotificationColor, string> = {
    success: 'i-lucide-circle-check',
    error: 'i-lucide-circle-alert',
    info: 'i-lucide-info',
    warning: 'i-lucide-triangle-alert',
}

export interface NotificationAction {
    label: string
    onClick: () => void
}

export function useNotification() {
    const toast = useToast()

    function notify(
        text: string,
        color: NotificationColor = 'success',
        action?: NotificationAction,
    ) {
        if (import.meta.server) return
        toast.add({
            title: () =>
                h(
                    'span',
                    {
                        'data-testid': 'global-snackbar-message',
                        'data-color': color,
                    },
                    text,
                ),
            color,
            icon: ICONS[color],
            duration: 6000,
            ...(action && {
                actions: [
                    {
                        label: action.label,
                        color: 'neutral',
                        variant: 'outline',
                        'data-testid': 'global-snackbar-action',
                        onClick: action.onClick,
                    },
                ],
            }),
            'data-testid': 'global-snackbar',
        } as Parameters<typeof toast.add>[0])
    }

    const success = (msg: string, action?: NotificationAction) =>
        notify(msg, 'success', action)
    const error = (msg: string) => notify(msg, 'error')
    const warning = (msg: string) => notify(msg, 'warning')
    const info = (msg: string) => notify(msg, 'info')

    return { notify, success, error, warning, info }
}
