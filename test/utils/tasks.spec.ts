import { describe, it, expect } from 'vitest'
import {
    isTaskOverdue,
    isUrgentDefect,
    defectSeverityByRoute,
    taskPriorityColor,
    taskPriorityLevel,
    taskPriorityName,
    statusesFilter,
    taskAge,
    taskStatusColor,
    tasksFilter,
    taskTitle,
} from '~/utils/tasks'

const t = (key: string) => key

describe('isUrgentDefect', () => {
    it('flags safety-relevant categories', () => {
        expect(isUrgentDefect('loose_bolt')).toBe(true)
        expect(isUrgentDefect('spinning_hold')).toBe(true)
        expect(isUrgentDefect('label_tag')).toBe(false)
        expect(isUrgentDefect(null)).toBe(false)
    })
})

describe('isTaskOverdue', () => {
    const now = new Date('2026-10-05T12:00:00')

    it('counts the whole due day as on time', () => {
        expect(
            isTaskOverdue({ due_date: '2026-10-05', status: 'open' }, now),
        ).toBe(false)
        expect(
            isTaskOverdue({ due_date: '2026-10-04', status: 'open' }, now),
        ).toBe(true)
    })

    it('never marks closed or undated tasks overdue', () => {
        expect(
            isTaskOverdue({ due_date: '2026-10-01', status: 'done' }, now),
        ).toBe(false)
        expect(
            isTaskOverdue({ due_date: '2026-10-01', status: 'waiting' }, now),
        ).toBe(true)
        expect(isTaskOverdue({ due_date: '', status: 'open' }, now)).toBe(false)
    })
})

describe('taskTitle', () => {
    it('prefers the explicit title', () => {
        expect(
            taskTitle(
                { kind: 'reset', title: 'Strip wall A', category: '' },
                t,
            ),
        ).toBe('Strip wall A')
    })

    it('falls back to the defect category, then the kind', () => {
        expect(
            taskTitle({ kind: 'defect', title: '', category: 'loose_bolt' }, t),
        ).toBe('tasks.categories.loose_bolt')
        expect(taskTitle({ kind: 'maintenance', title: '' }, t)).toBe(
            'tasks.kinds.maintenance',
        )
    })

    it('names a wish by route type and grade', () => {
        expect(
            taskTitle(
                { kind: 'wish', title: '', route_type: 'Boulder', grade: '6b' },
                t,
            ),
        ).toBe('routes.types.boulder 6b')
        expect(
            taskTitle({ kind: 'wish', title: '', route_type: 'Route' }, t),
        ).toBe('routes.types.route')
    })
})

describe('task priority levels', () => {
    it('round-trips names and sortable levels', () => {
        expect(taskPriorityLevel('low')).toBe(1)
        expect(taskPriorityLevel('urgent')).toBe(4)
        expect(taskPriorityName(3)).toBe('high')
        expect(taskPriorityName(0)).toBe('normal')
    })

    it('maps urgent to error and high to warning', () => {
        expect(taskPriorityColor(4)).toBe('error')
        expect(taskPriorityColor(3)).toBe('warning')
        expect(taskPriorityColor(2)).toBe('info')
    })
})

describe('tasksFilter', () => {
    it('ands the selected filters', () => {
        expect(
            tasksFilter({ kind: 'defect', assignee: 'u1', urgent: true }),
        ).toBe('kind = "defect" && assignee = "u1" && priority = 4')
    })

    it('scopes the board to one gym', () => {
        expect(tasksFilter({ gym: 'g1', kind: 'defect' })).toBe(
            'gym = "g1" && kind = "defect"',
        )
    })

    it('limits overdue tasks to dated ones before today', () => {
        expect(tasksFilter({ overdue: true })).toBe(
            '(due_date != "" && due_date < @todayStart)',
        )
    })

    it('returns an empty filter without options', () => {
        expect(tasksFilter({})).toBe('')
    })
})

describe('statusesFilter', () => {
    it('ors the statuses', () => {
        expect(statusesFilter(['open', 'waiting'])).toBe(
            '(status = "open" || status = "waiting")',
        )
    })
})

describe('taskAge', () => {
    const now = new Date('2026-10-10T12:00:00Z')
    const createdDaysAgo = (days: number) =>
        new Date(now.getTime() - days * 86_400_000).toISOString()

    it('ages urgent defects within days', () => {
        const urgent = { kind: 'defect' as const, priority: 4 }
        expect(taskAge({ ...urgent, created: createdDaysAgo(0) }, now)).toEqual(
            {
                days: 0,
                level: 'fresh',
            },
        )
        expect(
            taskAge({ ...urgent, created: createdDaysAgo(1) }, now).level,
        ).toBe('aging')
        expect(
            taskAge({ ...urgent, created: createdDaysAgo(2) }, now).level,
        ).toBe('stale')
    })

    it('gives other tasks a week before they age', () => {
        const chore = { kind: 'maintenance' as const, priority: 4 }
        expect(
            taskAge({ ...chore, created: createdDaysAgo(6) }, now).level,
        ).toBe('fresh')
        expect(
            taskAge({ ...chore, created: createdDaysAgo(7) }, now).level,
        ).toBe('aging')
        expect(
            taskAge({ ...chore, created: createdDaysAgo(14) }, now).level,
        ).toBe('stale')
    })
})

describe('taskStatusColor', () => {
    it('colours waiting tasks apart from open ones', () => {
        expect(taskStatusColor('waiting')).toBe('secondary')
        expect(taskStatusColor('open')).toBe('warning')
    })
})

describe('defectSeverityByRoute', () => {
    it('marks a route urgent when any open defect is urgent', () => {
        const severities = defectSeverityByRoute([
            { route: 'r1', category: 'label_tag' },
            { route: 'r1', category: 'loose_bolt' },
            { route: 'r1', category: 'other' },
            { route: 'r2', category: 'sharp_edge' },
        ])
        expect(severities.get('r1')).toBe('urgent')
        expect(severities.get('r2')).toBe('minor')
        expect(severities.has('r3')).toBe(false)
    })
})
