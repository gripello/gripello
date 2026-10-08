import { describe, expect, it } from 'vitest'
import { syncDrafts } from '../../app/utils/drafts'

describe('syncDrafts', () => {
    it('fills drafts for new records', () => {
        const drafts: Record<string, string> = {}
        const synced: Record<string, string> = {}
        syncDrafts(drafts, synced, [{ id: 'a', name: 'Hall' }])
        expect(drafts).toEqual({ a: 'Hall' })
    })

    it('keeps a name the user is editing when the list reloads', () => {
        const drafts: Record<string, string> = {}
        const synced: Record<string, string> = {}
        syncDrafts(drafts, synced, [{ id: 'a', name: 'Hall' }])
        drafts.a = 'Wall'
        syncDrafts(drafts, synced, [{ id: 'a', name: 'Hall' }])
        expect(drafts.a).toBe('Wall')
    })

    it('takes over a rename saved elsewhere for untouched drafts', () => {
        const drafts: Record<string, string> = {}
        const synced: Record<string, string> = {}
        syncDrafts(drafts, synced, [{ id: 'a', name: 'Hall' }])
        syncDrafts(drafts, synced, [{ id: 'a', name: 'Boulder Hall' }])
        expect(drafts.a).toBe('Boulder Hall')
    })
})
