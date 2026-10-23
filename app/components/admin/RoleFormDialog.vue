<template>
    <LayoutDialogShell
        v-model="dialog"
        :title="isEdit ? t('permissions.editRole') : t('permissions.addRole')"
        :persistent="hasChanges"
        sheet-on-mobile
        closable
        data-testid="role-form-dialog"
        :submit-label="isEdit ? t('actions.save') : t('permissions.createRole')"
        submit-icon="i-lucide-check"
        :submit-loading="saving"
        :submit-disabled="!valid || (isEdit && !hasChanges)"
        submit-test-id="role-form-submit"
        cancel-test-id="role-form-cancel"
        @submit="save"
    >
        <UForm ref="form" :state="draft" :validate="validateForm">
            <UFormField
                :label="t('permissions.roleName')"
                name="name"
                :error="nameError || undefined"
                :help="
                    nameLocked ? t('permissions.adminRoleLocked') : undefined
                "
                class="mb-4"
            >
                <UInput
                    v-model="draft.name"
                    :readonly="nameLocked"
                    icon="i-lucide-shield-user"
                    class="w-full"
                    data-testid="role-form-name"
                    @update:model-value="nameError = ''"
                />
            </UFormField>

            <UFormField
                :label="t('permissions.roleDescription')"
                name="description"
                class="mb-4"
            >
                <UInput
                    v-model="draft.description"
                    icon="i-lucide-text"
                    class="w-full"
                    data-testid="role-form-description"
                />
            </UFormField>

            <div class="text-xs text-muted mb-2">
                {{ t('permissions.roleColor') }}
            </div>

            <ColorSwatchPicker
                v-model="draft.color"
                :swatches="ROLE_COLORS"
                :label="t('permissions.roleColor')"
                test-id-prefix="role-form"
            />

            <div class="mt-4">
                <div class="text-xs text-muted mb-1">
                    {{ t('permissions.preview') }}
                </div>
                <UBadge
                    color="neutral"
                    :variant="draft.color ? 'solid' : 'soft'"
                    :style="
                        draft.color
                            ? {
                                  backgroundColor: draft.color,
                                  color: readableTextOn(draft.color),
                              }
                            : undefined
                    "
                    data-testid="role-form-preview"
                >
                    {{ draft.name || t('permissions.roleName') }}
                </UBadge>
            </div>
        </UForm>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import type { ApiError } from '~/api/client'
import { fieldErrorCode, formFieldErrors } from '~/utils/fieldErrors'
import { createRole, updateRole } from '~/api/members'
import type { Form } from '@nuxt/ui'
import { required, maxLength, validateRules } from '~/utils/validation'
import type { RoleRecord } from '~/types/models'
import { isProtectedRole } from '~/utils/roles'
import { toHex6 } from '#shared/utils/color'
import { readableTextOn } from '~/utils/color'

const ROLE_COLORS = [
    '#EF5350',
    '#EC407A',
    '#AB47BC',
    '#7C4DFF',
    '#5C6BC0',
    '#42A5F5',
    '#26A69A',
    '#66BB6A',
    '#9CCC65',
    '#FFA726',
    '#8D6E63',
    '#78909C',
]

const props = withDefaults(
    defineProps<{ role?: Partial<RoleRecord> | null }>(),
    { role: null },
)

const emit = defineEmits<{
    saved: [action: 'updated' | 'created', roleId: string]
    close: []
}>()

const { t } = useI18n()
const gymId = useCurrentGymId()
const { error: notifyError } = useNotification()

const dialog = ref(false)
const form = ref<Form<{
    name: string
    description: string
    color: string
}> | null>(null)
const saving = ref(false)
const nameError = ref('')

const draft = reactive({ name: '', description: '', color: '' })
const original = reactive({ name: '', description: '', color: '' })

const isEdit = computed(() => !!props.role?.id)

const nameLocked = computed(
    () => isEdit.value && isProtectedRole({ name: props.role?.name ?? '' }),
)

const nameRules = [required(t), maxLength(t, 50)]
const descriptionRules = [maxLength(t, 200)]
const validateForm = (state: Record<string, unknown>) =>
    validateRules(state, { name: nameRules, description: descriptionRules })
const valid = computed(() => validateForm(draft).length === 0)

const hasChanges = computed(
    () =>
        draft.name !== original.name ||
        draft.description !== original.description ||
        draft.color !== original.color,
)

watch(
    () => props.role,
    (role) => {
        if (!role) {
            dialog.value = false
            return
        }
        Object.assign(draft, {
            name: role.name ?? '',
            description: role.description ?? '',
            color: toHex6(role.color),
        })
        Object.assign(original, { ...draft })
        nameError.value = ''
        dialog.value = true
    },
    { immediate: true },
)

watch(dialog, (open) => {
    if (!open) emit('close')
})

function close() {
    dialog.value = false
}

async function save() {
    if (saving.value) return
    saving.value = true
    try {
        if ((await form.value?.validate({ silent: true })) === false) return
        const payload = {
            name: nameLocked.value
                ? (props.role?.name ?? '')
                : draft.name.trim(),
            description: draft.description.trim(),
            color: toHex6(draft.color),
        }
        const saved = isEdit.value
            ? await updateRole(props.role!.id!, payload)
            : await createRole(gymId.value, {
                  ...payload,
                  permissions: props.role?.permissions ?? [],
              })
        emit('saved', isEdit.value ? 'updated' : 'created', saved.id)
        close()
    } catch (err) {
        const nameCode = fieldErrorCode(err, 'name')
        if (nameCode) {
            nameError.value =
                nameCode === 'validation_not_unique'
                    ? t('permissions.nameTaken')
                    : formFieldErrors(err, ['name'], t)[0]!.message
            return
        }
        if ((err as ApiError)?.status === 403) {
            notifyError(t('permissions.cannotGrant'))
            return
        }
        console.error('Failed to save role:', err)
        notifyError(t('permissions.roleSaveError'))
    } finally {
        saving.value = false
    }
}
</script>
