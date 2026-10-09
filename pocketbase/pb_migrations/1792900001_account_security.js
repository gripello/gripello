/// <reference path="../pb_data/types.d.ts" />
const AUTH_RATE_LIMIT = {
    label: 'POST /api/auth/',
    audience: '',
    duration: 300,
    maxRequests: 30,
}
const OWN_SESSION = '@request.auth.id != "" && user = @request.auth.id'

const created = (collection) => ({
    id: `autodate_${collection}_created`,
    name: 'created',
    type: 'autodate',
    onCreate: true,
    onUpdate: false,
})
const userRelation = (id) => ({
    id,
    name: 'user',
    type: 'relation',
    collectionId: '_pb_users_auth_',
    cascadeDelete: true,
    maxSelect: 1,
    required: true,
})

migrate(
    (app) => {
        app.save(
            new Collection({
                id: 'pbc_mfa_factors',
                name: 'mfa_factors',
                type: 'base',
                listRule: null,
                viewRule: null,
                createRule: null,
                updateRule: null,
                deleteRule: null,
                fields: [
                    userRelation('relation_mfa_factors_user'),
                    {
                        id: 'select_mfa_factors_kind',
                        name: 'kind',
                        type: 'select',
                        required: true,
                        maxSelect: 1,
                        values: ['totp', 'passkey'],
                    },
                    {
                        id: 'text_mfa_factors_name',
                        name: 'name',
                        type: 'text',
                        max: 60,
                    },
                    {
                        id: 'date_mfa_factors_last_used',
                        name: 'last_used',
                        type: 'date',
                    },
                    {
                        id: 'text_mfa_factors_secret',
                        name: 'secret',
                        type: 'text',
                        hidden: true,
                    },
                    {
                        id: 'text_mfa_factors_algorithm',
                        name: 'algorithm',
                        type: 'text',
                    },
                    {
                        id: 'number_mfa_factors_digits',
                        name: 'digits',
                        type: 'number',
                        onlyInt: true,
                    },
                    {
                        id: 'number_mfa_factors_period',
                        name: 'period',
                        type: 'number',
                        onlyInt: true,
                    },
                    {
                        id: 'number_mfa_factors_last_step',
                        name: 'last_step',
                        type: 'number',
                        onlyInt: true,
                    },
                    {
                        id: 'text_mfa_factors_credential_id',
                        name: 'credential_id',
                        type: 'text',
                    },
                    {
                        id: 'text_mfa_factors_public_key',
                        name: 'public_key',
                        type: 'text',
                        hidden: true,
                    },
                    {
                        id: 'number_mfa_factors_sign_count',
                        name: 'sign_count',
                        type: 'number',
                        onlyInt: true,
                    },
                    {
                        id: 'text_mfa_factors_aaguid',
                        name: 'aaguid',
                        type: 'text',
                    },
                    {
                        id: 'json_mfa_factors_transports',
                        name: 'transports',
                        type: 'json',
                        maxSize: 2000,
                    },
                    {
                        id: 'bool_mfa_factors_backup_eligible',
                        name: 'backup_eligible',
                        type: 'bool',
                    },
                    {
                        id: 'bool_mfa_factors_backup_state',
                        name: 'backup_state',
                        type: 'bool',
                    },
                    {
                        id: 'text_mfa_factors_attestation_type',
                        name: 'attestation_type',
                        type: 'text',
                    },
                    {
                        id: 'text_mfa_factors_user_handle',
                        name: 'user_handle',
                        type: 'text',
                    },
                    created('mfa_factors'),
                ],
                indexes: [
                    'CREATE INDEX `idx_mfa_factors_user` ON `mfa_factors` (`user`)',
                    "CREATE UNIQUE INDEX `idx_mfa_factors_totp` ON `mfa_factors` (`user`) WHERE `kind` = 'totp'",
                    "CREATE UNIQUE INDEX `idx_mfa_factors_credential` ON `mfa_factors` (`credential_id`) WHERE `credential_id` != ''",
                ],
            }),
        )

        app.save(
            new Collection({
                id: 'pbc_mfa_recovery_codes',
                name: 'mfa_recovery_codes',
                type: 'base',
                listRule: null,
                viewRule: null,
                createRule: null,
                updateRule: null,
                deleteRule: null,
                fields: [
                    userRelation('relation_mfa_recovery_codes_user'),
                    {
                        id: 'json_mfa_recovery_codes_codes',
                        name: 'codes',
                        type: 'json',
                        hidden: true,
                        maxSize: 4000,
                    },
                    created('mfa_recovery_codes'),
                ],
                indexes: [
                    'CREATE UNIQUE INDEX `idx_mfa_recovery_codes_user` ON `mfa_recovery_codes` (`user`)',
                ],
            }),
        )

        app.save(
            new Collection({
                id: 'pbc_sessions',
                name: 'sessions',
                type: 'base',
                listRule: OWN_SESSION,
                viewRule: OWN_SESSION,
                createRule: null,
                updateRule: null,
                deleteRule: OWN_SESSION,
                fields: [
                    userRelation('relation_sessions_user'),
                    {
                        id: 'text_sessions_method',
                        name: 'method',
                        type: 'text',
                        max: 30,
                    },
                    {
                        id: 'text_sessions_user_agent',
                        name: 'user_agent',
                        type: 'text',
                        max: 300,
                    },
                    {
                        id: 'text_sessions_ip',
                        name: 'ip',
                        type: 'text',
                        max: 64,
                    },
                    {
                        id: 'date_sessions_last_seen',
                        name: 'last_seen',
                        type: 'date',
                    },
                    created('sessions'),
                ],
                indexes: [
                    'CREATE INDEX `idx_sessions_user` ON `sessions` (`user`)',
                    'CREATE INDEX `idx_sessions_last_seen` ON `sessions` (`last_seen`)',
                ],
            }),
        )

        app.save(
            new Collection({
                id: 'pbc_login_lockouts',
                name: 'login_lockouts',
                type: 'base',
                listRule: null,
                viewRule: null,
                createRule: null,
                updateRule: null,
                deleteRule: null,
                fields: [
                    {
                        id: 'text_login_lockouts_key',
                        name: 'key',
                        type: 'text',
                        required: true,
                        max: 64,
                    },
                    {
                        id: 'number_login_lockouts_failures',
                        name: 'failures',
                        type: 'number',
                        onlyInt: true,
                    },
                    {
                        id: 'date_login_lockouts_window_start',
                        name: 'window_start',
                        type: 'date',
                    },
                    {
                        id: 'date_login_lockouts_locked_until',
                        name: 'locked_until',
                        type: 'date',
                    },
                ],
                indexes: [
                    'CREATE UNIQUE INDEX `idx_login_lockouts_key` ON `login_lockouts` (`key`)',
                ],
            }),
        )

        const settings = app.settings()
        settings.rateLimits.rules = [
            ...settings.rateLimits.rules.filter(
                (rule) => rule.label !== AUTH_RATE_LIMIT.label,
            ),
            AUTH_RATE_LIMIT,
        ]
        app.save(settings)
    },
    (app) => {
        const settings = app.settings()
        settings.rateLimits.rules = settings.rateLimits.rules.filter(
            (rule) => rule.label !== AUTH_RATE_LIMIT.label,
        )
        app.save(settings)

        for (const id of [
            'pbc_login_lockouts',
            'pbc_sessions',
            'pbc_mfa_recovery_codes',
            'pbc_mfa_factors',
        ]) {
            app.delete(app.findCollectionByNameOrId(id))
        }
    },
)
