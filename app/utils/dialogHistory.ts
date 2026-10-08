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

function onPopState(event: PopStateEvent) {
    const ownBackStep = ownBackSteps > 0
    const top = openDialogs.at(-1)
    if (!ownBackStep && (!top || event.state?.dialogShell === top.id)) return
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

// Window listeners fire in registration order, so this must be added before vue-router's own.
export function listenBeforeRouter() {
    window.addEventListener('popstate', onPopState)
}

export function trackDialogPath(currentPath: () => string) {
    routerPath = currentPath
}

export function pushDialogEntry(close: () => void) {
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
}
