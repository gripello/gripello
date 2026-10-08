interface OpenDialog {
    id: number
    close: () => void
}

const openDialogs: OpenDialog[] = []
let lastId = 0
let ownBackSteps = 0
const backStepWaiters: (() => void)[] = []
let routerPath = () => currentUrlPath()

function currentUrlPath() {
    return location.pathname + location.search + location.hash
}

function stopListeningWhenIdle() {
    if (!openDialogs.length && !ownBackSteps)
        window.removeEventListener('popstate', onPopState, true)
}

function onPopState(event: PopStateEvent) {
    const ownBackStep = ownBackSteps > 0
    const top = openDialogs.at(-1)
    if (!ownBackStep && (!top || event.state?.dialogShell === top.id)) return
    // Runs before vue-router's listener, which must not see a back step that only closes a dialog.
    event.stopImmediatePropagation()
    const path = routerPath()
    if (path !== currentUrlPath())
        history.replaceState({ ...history.state, current: path }, '', path)
    if (ownBackStep) {
        ownBackSteps--
        if (!ownBackSteps) backStepWaiters.splice(0).forEach((done) => done())
    } else {
        openDialogs.pop()
        top!.close()
    }
    stopListeningWhenIdle()
}

export function settleDialogHistory(): Promise<void> | undefined {
    const top = openDialogs.at(-1)
    if (top && history.state?.dialogShell === top.id) {
        const steps = openDialogs.length
        openDialogs.length = 0
        ownBackSteps++
        history.go(-steps)
    }
    if (!ownBackSteps) return
    return new Promise((resolve) => {
        backStepWaiters.push(resolve)
        setTimeout(resolve, 1000)
    })
}

export function trackDialogPath(currentPath: () => string) {
    routerPath = currentPath
}

export function pushDialogEntry(close: () => void) {
    if (!openDialogs.length && !ownBackSteps)
        window.addEventListener('popstate', onPopState, true)
    const id = ++lastId
    history.pushState({ ...history.state, dialogShell: id }, '')
    openDialogs.push({ id, close })
    return () => releaseDialogEntry(id)
}

function releaseDialogEntry(id: number) {
    const index = openDialogs.findIndex((dialog) => dialog.id === id)
    if (index === -1) return
    openDialogs.splice(index, 1)
    if (history.state?.dialogShell === id) {
        ownBackSteps++
        history.back()
    }
    stopListeningWhenIdle()
}
