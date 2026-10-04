<template>
    <LayoutDialogShell
        v-model="dialog"
        :title="isEdit ? t('permissions.editRole') : t('permissions.addRole')"
        :persistent="hasChanges"
        sheet-on-mobile
        closable
        data-testid="role-form-dialog"
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

            <div class="flex flex-wrap gap-2 items-center">
                <button
                    v-for="c in ROLE_COLORS"
                    :key="c"
                    type="button"
                    class="color-dot"
                    :aria-label="c"
                    :aria-pressed="isSelected(c)"
                    :style="{
                        backgroundColor: c,
                        boxShadow: isSelected(c)
                            ? '0 0 0 2px var(--ui-bg), 0 0 0 4px ' + c
                            : 'none',
                    }"
                    :data-testid="`role-form-swatch-${c.slice(1)}`"
                    @click="pickSwatch(c)"
                />

                <UButton
                    color="neutral"
                    :variant="customOpen ? 'soft' : 'ghost'"
                    size="sm"
                    icon="i-lucide-pipette"
                    data-testid="role-form-color-custom"
                    @click="toggleCustom"
                >
                    {{ t('permissions.customColor') }}
                </UButton>
            </div>

            <div v-if="customOpen" class="color-picker-section mt-3">
                <UColorPicker v-model="draft.color" />
            </div>

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

        <template #actions>
            <UButton
                color="neutral"
                variant="ghost"
                data-testid="role-form-cancel"
                @click="close"
            >
                {{ t('actions.cancel') }}
            </UButton>
            <div class="flex-1" />
            <UButton
                :disabled="!valid || (isEdit && !hasChanges)"
                :loading="saving"
                color="primary"
                icon="i-lucide-check"
                data-testid="role-form-submit"
                @click="save"
            >
                {{ isEdit ? t('actions.save') : t('permissions.createRole') }}
            </UButton>
        </template>
    </LayoutDialogShell>
</template>

<script setup lang="ts">
import type { ClientResponseError } from 'pocketbase'
import type { Form } from '@nuxt/ui'
import { required, maxLength, validateRules } from '~/utils/validation'
import type { RoleRecord } from '~/types/models'
import { isProtectedRole } from '~/utils/roles'
import { toHex6, readableTextOn } from '~/utils/color'

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
const pb = usePocketbase()
const gymId = useCurrentGymId()
const { error: notifyError } = useNotification()

const dialog = ref(false)
const form = ref<Form<{
    name: string
    description: string
    color: string
}> | null>(null)
const saving = ref(false)
const customOpen = ref(false)
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

function isSelected(hex: string) {
    return toHex6(draft.color) === toHex6(hex)
}

function pickSwatch(hex: string) {
    draft.color = hex
    customOpen.value = false
}

function toggleCustom() {
    if (!customOpen.value && !draft.color) draft.color = ROLE_COLORS[0]!
    customOpen.value = !customOpen.value
}

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
        customOpen.value =
            !!draft.color && !ROLE_COLORS.some((c) => isSelected(c))
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
    if ((await form.value?.validate({ silent: true })) === false) return

    const payload = {
        name: nameLocked.value ? (props.role?.name ?? '') : draft.name.trim(),
        description: draft.description.trim(),
        color: toHex6(draft.color),
    }

    saving.value = true
    try {
        const saved = isEdit.value
            ? await pb.collection('roles').update(props.role!.id!, payload)
            : await pb.collection('roles').create({
                  ...payload,
                  gym: gymId.value,
                  permissions: props.role?.permissions ?? [],
              })
        emit('saved', isEdit.value ? 'updated' : 'created', saved.id)
        close()
    } catch (err) {
        if ((err as ClientResponseError)?.response?.data?.name) {
            nameError.value = t('permissions.nameTaken')
            return
        }
        if ((err as ClientResponseError)?.status === 403) {
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

<style scoped>
.color-dot {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: box-shadow 0.15s;
}

.color-dot:hover {
    box-shadow: 0 0 0 2px rgba(128, 128, 128, 0.5);
}
</style>
