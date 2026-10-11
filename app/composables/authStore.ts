import { AUTH_COOKIE, SESSION_ONLY_AUTH_COOKIE } from '~/utils/clientStorage'
import { tokenExpired, tokenPayload } from '~/utils/session'

export type ApiRecord = { id: string; [key: string]: any }
export type AuthRecord = ApiRecord | null
type AuthChange = (token: string, record: AuthRecord) => void

const COOKIE_LIMIT = 4096
const TRIMMED_RECORD_FIELDS = ['collectionId', 'collectionName', 'verified']

export function readCookie(cookies: string, name: string) {
    for (const pair of cookies.split(';')) {
        const index = pair.indexOf('=')
        if (index < 0 || pair.slice(0, index).trim() !== name) continue
        let value = pair.slice(index + 1).trim()
        if (value.startsWith('"')) value = value.slice(1, -1)
        try {
            return decodeURIComponent(value)
        } catch {
            return value
        }
    }
    return ''
}

export function authCookie(
    token: string,
    record: AuthRecord,
    { secure = false, session = false } = {},
) {
    const exp = Number(tokenPayload(token).exp)
    const expires = session
        ? ''
        : `; Expires=${new Date(exp ? exp * 1000 : 0).toUTCString()}`
    const attributes = `; Path=/${expires}${secure ? '; Secure' : ''}; SameSite=Lax`
    const serialize = (value: AuthRecord) =>
        `${AUTH_COOKIE}=${encodeURIComponent(JSON.stringify({ token, record: value }))}${attributes}`
    const full = serialize(record)
    if (!record || new Blob([full]).size <= COOKIE_LIMIT) return full
    const trimmed: ApiRecord = { id: record.id, email: record.email }
    for (const field of TRIMMED_RECORD_FIELDS)
        if (field in record) trimmed[field] = record[field]
    return serialize(trimmed)
}

export class AuthStore {
    token = ''
    record: AuthRecord = null
    persistent = true
    writesCookie = false
    #listeners = new Set<AuthChange>()

    constructor(cookies: string, writesCookie = false) {
        this.writesCookie = writesCookie
        this.persistent = !cookies
            .split('; ')
            .includes(`${SESSION_ONLY_AUTH_COOKIE}=1`)
        let data: { token?: string; record?: AuthRecord; model?: AuthRecord } =
            {}
        try {
            const parsed = JSON.parse(readCookie(cookies, AUTH_COOKIE))
            if (parsed && typeof parsed === 'object') data = parsed
        } catch {}
        this.save(data.token || '', data.record || data.model || null)
    }

    get isValid() {
        return !tokenExpired(this.token)
    }

    save(token: string, record?: AuthRecord) {
        this.token = token || ''
        this.record = record || null
        this.#persist()
        for (const listener of this.#listeners)
            listener(this.token, this.record)
    }

    clear() {
        this.persistent = true
        this.save('', null)
    }

    onChange(callback: AuthChange, fireImmediately = false) {
        this.#listeners.add(callback)
        if (fireImmediately) callback(this.token, this.record)
        return () => void this.#listeners.delete(callback)
    }

    #persist() {
        if (!this.writesCookie) return
        const session = !this.persistent && this.isValid
        document.cookie = authCookie(this.token, this.record, {
            secure: location.protocol === 'https:',
            session,
        })
        document.cookie = `${SESSION_ONLY_AUTH_COOKIE}=1; Path=/; SameSite=Lax${session ? '' : '; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT'}`
    }
}

declare global {
    var _authStore: AuthStore | undefined
}

export const useAuthStore = (): AuthStore => {
    if (import.meta.server)
        return new AuthStore(useRequestHeaders(['cookie']).cookie ?? '')
    globalThis._authStore ??= new AuthStore(document.cookie, true)
    return globalThis._authStore
}

export const setAuthPersistent = (persistent: boolean) => {
    useAuthStore().persistent = persistent
}
