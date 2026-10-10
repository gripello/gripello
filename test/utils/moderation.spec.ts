import { describe, expect, it } from 'vitest'
import {
    actionLabelKey,
    decisionReason,
    isNewSince,
    moderationActions,
    moderationBadgeCount,
    moderationFiles,
    moderationText,
    moderationViewQuery,
    openReportCount,
    viewOfState,
} from '~/utils/moderation'

const staff = { platform: false, gymStaff: true }
const platform = { platform: true, gymStaff: false }

describe('moderationViewQuery', () => {
    it('maps a view to its states and order', () => {
        expect(moderationViewQuery('hidden')).toEqual({
            state: ['hidden'],
            sort: 'reviewed',
        })
        expect(moderationViewQuery('approval')).toEqual({ state: ['pending'] })
    })

    it('limits the platform queue to reported or gym-less cases', () => {
        expect(moderationViewQuery('decide', true)).toEqual({
            state: ['unreviewed'],
            queue: 'platform',
        })
        expect(moderationViewQuery('all', true)).toEqual({
            state: ['unreviewed', 'pending'],
        })
    })
})

describe('moderationActions', () => {
    it('lets only the gym publish or decline waiting uploads', () => {
        expect(
            moderationActions({ state: 'pending', hidden_by: '' }, staff),
        ).toEqual(['reject', 'approve'])
        expect(
            moderationActions({ state: 'pending', hidden_by: '' }, platform),
        ).toEqual(['hide'])
    })

    it('keeps platform-hidden content out of gym hands', () => {
        const item = { state: 'hidden', hidden_by: 'platform' } as const
        expect(moderationActions(item, staff)).toEqual([])
        expect(moderationActions(item, platform)).toEqual(['restore'])
        expect(
            moderationActions({ state: 'hidden', hidden_by: 'gym' }, staff),
        ).toEqual(['restore'])
    })

    it('offers keep and hide on visible content', () => {
        expect(
            moderationActions({ state: 'unreviewed', hidden_by: '' }, staff),
        ).toEqual(['approve', 'hide'])
        expect(
            moderationActions({ state: 'approved', hidden_by: '' }, platform),
        ).toEqual(['hide'])
    })
})

describe('actionLabelKey', () => {
    it('names approval after its effect', () => {
        expect(actionLabelKey({ state: 'pending' }, 'approve')).toBe(
            'moderation.actions.publish',
        )
        expect(actionLabelKey({ state: 'unreviewed' }, 'approve')).toBe(
            'moderation.actions.keep',
        )
        expect(actionLabelKey({ state: 'hidden' }, 'restore')).toBe(
            'moderation.actions.restore',
        )
    })
})

describe('openReportCount', () => {
    it('counts only reports still waiting for a decision', () => {
        expect(
            openReportCount([
                { status: 'open' },
                { status: 'actioned' },
                { status: 'open' },
            ]),
        ).toBe(2)
        expect(openReportCount()).toBe(0)
    })
})

describe('decisionReason', () => {
    it('joins the chosen reason and the explanation', () => {
        expect(decisionReason('Spam or fraud', ' links to a shop ')).toBe(
            'Spam or fraud: links to a shop',
        )
        expect(decisionReason('Spam or fraud', '')).toBe('Spam or fraud')
        expect(decisionReason('', 'off topic')).toBe('off topic')
    })
})

describe('isNewSince', () => {
    it('marks content created after the last visit', () => {
        const seen = '2026-10-05T10:00:00Z'
        expect(isNewSince('2026-10-06 08:00:00.000Z', seen)).toBe(true)
        expect(isNewSince('2026-10-04 08:00:00.000Z', seen)).toBe(false)
        expect(isNewSince('2026-10-06 08:00:00.000Z', undefined)).toBe(false)
    })
})

describe('moderationBadgeCount', () => {
    it('adds waiting uploads to open decisions', () => {
        expect(moderationBadgeCount({ decide: 3, waiting: 2 })).toBe(5)
        expect(moderationBadgeCount({ decide: 4 })).toBe(4)
    })
})

describe('moderationText', () => {
    it('joins the filled text fields of a profile', () => {
        expect(
            moderationText({
                content_type: 'profile',
                snapshot: { username: 'rude', firstname: '', name: 'Doe' },
            }),
        ).toBe('rude · Doe')
    })

    it('copes with a missing snapshot', () => {
        expect(moderationText({ content_type: 'rating', snapshot: null })).toBe(
            '',
        )
    })
})

describe('moderationFiles', () => {
    const base = {
        id: 'item1',
        content_type: 'beta_video',
        content_id: 'vid1',
        snapshot: { file: 'beta.mp4' },
        files: ['beta_q.mp4'],
    } as const

    it('points at the live record while content is visible', () => {
        expect(moderationFiles({ ...base, state: 'unreviewed' })).toEqual([
            {
                collectionName: 'beta_videos',
                id: 'vid1',
                name: 'beta.mp4',
                video: true,
            },
        ])
    })

    it('points at the quarantine while content is hidden or waiting', () => {
        expect(moderationFiles({ ...base, state: 'hidden' })).toEqual([
            {
                collectionName: 'moderation_items',
                id: 'item1',
                name: 'beta_q.mp4',
                video: true,
            },
        ])
    })
})

describe('viewOfState', () => {
    it('opens a case in the tab that lists it', () => {
        expect(viewOfState('pending', false)).toBe('approval')
        expect(viewOfState('pending', true)).toBe('all')
        expect(viewOfState('unreviewed', false)).toBe('decide')
        expect(viewOfState('hidden', true)).toBe('hidden')
        expect(viewOfState('approved', false)).toBe('history')
    })
})

describe('isNewSince with PocketBase dates', () => {
    it('reads the space-separated server format', () => {
        expect(
            isNewSince('2026-10-06 08:00:00.000Z', '2026-10-06 07:00:00.000Z'),
        ).toBe(true)
    })
})
