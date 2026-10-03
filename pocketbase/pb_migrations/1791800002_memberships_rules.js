/// <reference path="../pb_data/types.d.ts" />
const member = (perm, gym = 'gym') =>
    `@request.auth.memberships_via_user.gym ?= ${gym} && @request.auth.memberships_via_user.role.permissions.name ?= "${perm}"`
const legacy = (perm) => `@request.auth.role.permissions.name ?= "${perm}"`

const SIGNED_IN = '@request.auth.id != ""'
const OWN_ENTRY = '(@request.auth.id != "" && user = @request.auth.id)'
const OWN_SCORE = '(@request.auth.id != "" && entry.user = @request.auth.id)'
const PUBLIC_SCORES =
    'entry.user = @request.auth.id || competition.status = "published" || (competition.status != "draft" && competition.live_ranking = true && (competition.freeze_at = "" || competition.freeze_at > @now))'
const PUBLIC_ENTRIES = '(competition.status != "draft" && hidden = false)'
const OPEN_REGISTRATION =
    '@request.auth.id = "" && @collection.settings.allow_registration ?= true'

function rules(list, view, create, update, remove) {
    return { list, view, create, update, remove }
}

function staffRules(guard, create = guard) {
    return rules(guard, guard, create, guard, guard)
}

function publicRules(guard, create) {
    return rules('', '', create, guard, guard)
}

function competitionChildRules(can) {
    const manage = can('manage_competitions', 'competition.gym')
    const visible = `competition.status != "draft" || ${manage}`
    return rules(visible, visible, manage, manage, manage)
}

function ruleSet(can, usersRules) {
    const staffOrJudge = (gym) =>
        `${can('manage_competitions', gym)} || ${can('judge_competitions', gym)}`
    const entryStaff = staffOrJudge('competition.gym')
    const scoreWriters = `${staffOrJudge('entry.competition.gym')} || ${OWN_SCORE}`
    const draftVisible = `status != "draft" || ${can('manage_competitions')}`
    return {
        gyms: rules('', '', null, can('manage_settings', 'id'), null),
        settings: rules(
            '',
            '',
            can === member ? null : legacy('manage_settings'),
            can === member ? null : legacy('manage_settings'),
            null,
        ),
        roles: rules(
            SIGNED_IN,
            SIGNED_IN,
            can('manage_users', '@request.body.gym'),
            can('manage_users'),
            `${can('manage_users')} && name != "admin"`,
        ),
        locations: publicRules(
            can('manage_settings'),
            can('manage_settings', '@request.body.gym'),
        ),
        walls: publicRules(
            can('manage_settings'),
            can('manage_settings', 'location.gym'),
        ),
        routes: rules(
            '',
            '',
            can === member
                ? `${member('manage_routes', 'location.gym')} || ${member('manage_routes', '@request.body.gym')}`
                : legacy('manage_routes'),
            `${can('manage_routes')} || (${can('run_inventory')} && @request.body.archived:isset = true)`,
            can('manage_routes'),
        ),
        ratings: rules(
            '',
            '',
            '',
            can('manage_comments'),
            can('manage_comments'),
        ),
        tasks: staffRules(can('manage_tasks'), ''),
        task_assignees: rules(
            can('manage_tasks'),
            can('manage_tasks'),
            null,
            null,
            null,
        ),
        reports: staffRules(can('manage_reports'), ''),
        audit_logs: rules(
            `${SIGNED_IN} && (${can('view_audit_log')} || actor = @request.auth.id)`,
            `${SIGNED_IN} && (${can('view_audit_log')} || actor = @request.auth.id)`,
            null,
            null,
            null,
        ),
        competitions: rules(
            draftVisible,
            draftVisible,
            can('manage_competitions', 'location.gym'),
            can('manage_competitions'),
            can('manage_competitions'),
        ),
        competition_categories: competitionChildRules(can),
        competition_routes: competitionChildRules(can),
        competition_entries: rules(
            `${entryStaff} || ${OWN_ENTRY} || ${PUBLIC_ENTRIES}`,
            `${entryStaff} || ${OWN_ENTRY} || ${PUBLIC_ENTRIES}`,
            SIGNED_IN,
            `${can('manage_competitions', 'competition.gym')} || ${OWN_ENTRY}`,
            `${can('manage_competitions', 'competition.gym')} || ${OWN_ENTRY}`,
        ),
        competition_scores: rules(
            `${staffOrJudge('competition.gym')} || ${PUBLIC_SCORES}`,
            `${staffOrJudge('competition.gym')} || ${PUBLIC_SCORES}`,
            scoreWriters,
            scoreWriters,
            can('manage_competitions', 'competition.gym'),
        ),
        users: usersRules,
    }
}

const MEMBER_USERS = rules(
    'id = @request.auth.id || (memberships_via_user.gym ?= @request.auth.memberships_via_user.gym && @request.auth.memberships_via_user.role.permissions.name ?= "manage_users")',
    'id = @request.auth.id || (memberships_via_user.gym ?= @request.auth.memberships_via_user.gym && @request.auth.memberships_via_user.role.permissions.name ?= "manage_users")',
    OPEN_REGISTRATION,
    'id = @request.auth.id',
    'id = @request.auth.id',
)

const LEGACY_USERS = rules(
    `id = @request.auth.id || ${legacy('manage_users')}`,
    `id = @request.auth.id || ${legacy('manage_users')}`,
    `${legacy('manage_users')} || (${OPEN_REGISTRATION} && @request.body.role:isset = false)`,
    `id = @request.auth.id || ${legacy('manage_users')}`,
    `id = @request.auth.id || (${legacy('manage_users')} && id != @request.auth.id)`,
)

const MEMBERSHIP_READ = `user = @request.auth.id || ${member('manage_users')}`

const MEMBERSHIP_RULES = rules(
    MEMBERSHIP_READ,
    MEMBERSHIP_READ,
    member('manage_users', '@request.body.gym'),
    member('manage_users'),
    member('manage_users'),
)

const NO_ACCESS = rules(null, null, null, null, null)

const FULL_NAME =
    "COALESCE(NULLIF(TRIM(COALESCE(users.firstname, '') || ' ' || COALESCE(users.name, '')), ''), users.username)"
const PERMITTED = (roleColumn) =>
    `JOIN roles ON roles.id = ${roleColumn} JOIN json_each(roles.permissions) AS granted JOIN permissions ON permissions.id = granted.value WHERE permissions.name = 'manage_tasks'`
const MEMBER_ASSIGNEES = `SELECT memberships.id, memberships.user, memberships.gym, ${FULL_NAME} AS name FROM memberships JOIN users ON users.id = memberships.user ${PERMITTED('memberships.role')}`
const LEGACY_ASSIGNEES = `SELECT DISTINCT users.id, ${FULL_NAME} AS name FROM users ${PERMITTED('users.role')}`

const USER_ROLE_FIELD = {
    cascadeDelete: false,
    collectionId: 'roles_collection_id',
    id: 'relation_user_role',
    maxSelect: 1,
    minSelect: 0,
    name: 'role',
    required: false,
    type: 'relation',
}

function applyRules(collection, set) {
    collection.listRule = set.list
    collection.viewRule = set.view
    collection.createRule = set.create
    collection.updateRule = set.update
    collection.deleteRule = set.remove
}

function saveRules(app, sets) {
    for (const [name, set] of Object.entries(sets)) {
        if (name === 'users' || name === 'task_assignees') continue
        const collection = app.findCollectionByNameOrId(name)
        applyRules(collection, set)
        app.save(collection)
    }
}

function setAssignees(app, query, set) {
    const view = app.findCollectionByNameOrId('task_assignees')
    view.viewQuery = query
    applyRules(view, NO_ACCESS)
    app.save(view)
    applyRules(view, set)
    app.save(view)
}

function createMemberships(app) {
    const memberships = app.findCollectionByNameOrId('memberships')
    const rolesById = new Map(
        app.findAllRecords('roles').map((role) => [role.id, role]),
    )
    for (const user of app.findAllRecords('users')) {
        const role = rolesById.get(user.getString('role'))
        if (!role || role.getString('name') === 'user') continue
        if (!role.getString('gym')) continue
        const membership = new Record(memberships)
        membership.set('user', user.id)
        membership.set('gym', role.getString('gym'))
        membership.set('role', role.id)
        app.save(membership)
    }
}

function restoreUserRoles(app) {
    const roles = app.findCollectionByNameOrId('roles')
    const firstGym = app.findRecordsByFilter('gyms', '', 'created', 1, 0)[0]
    const fallback = new Record(roles)
    fallback.set('name', 'user')
    fallback.set('description', 'Regular user')
    fallback.set('color', '#78909C')
    fallback.set('gym', firstGym ? firstGym.id : '')
    app.saveNoValidate(fallback)

    const roleByUser = new Map()
    for (const membership of app.findAllRecords('memberships')) {
        roleByUser.set(
            membership.getString('user'),
            membership.getString('role'),
        )
    }
    for (const user of app.findAllRecords('users')) {
        user.set('role', roleByUser.get(user.id) || fallback.id)
        app.saveNoValidate(user)
    }
}

migrate(
    (app) => {
        createMemberships(app)

        const memberships = app.findCollectionByNameOrId('memberships')
        applyRules(memberships, MEMBERSHIP_RULES)
        app.save(memberships)

        saveRules(app, ruleSet(member, MEMBER_USERS))
        setAssignees(app, MEMBER_ASSIGNEES, ruleSet(member).task_assignees)

        const users = app.findCollectionByNameOrId('users')
        applyRules(users, MEMBER_USERS)
        users.fields.removeById('relation_user_role')
        app.save(users)

        for (const role of app.findRecordsByFilter(
            'roles',
            "name = 'user'",
            '',
            0,
            0,
        )) {
            app.delete(role)
        }
    },
    (app) => {
        const users = app.findCollectionByNameOrId('users')
        users.fields.add(new Field(USER_ROLE_FIELD))
        app.save(users)
        restoreUserRoles(app)
        applyRules(users, LEGACY_USERS)
        app.save(users)

        saveRules(app, ruleSet(legacy, LEGACY_USERS))
        setAssignees(app, LEGACY_ASSIGNEES, ruleSet(legacy).task_assignees)

        const memberships = app.findCollectionByNameOrId('memberships')
        applyRules(memberships, NO_ACCESS)
        app.save(memberships)
        app.db().newQuery('DELETE FROM memberships').execute()
    },
)
