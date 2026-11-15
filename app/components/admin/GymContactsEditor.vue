<template>
    <div class="flex flex-col">
        <LayoutListGroup flush>
            <LayoutListRow
                dense
                icon="i-lucide-building-2"
                icon-active
                data-testid="settings-contact-general"
            >
                <button
                    type="button"
                    class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-start"
                    data-testid="settings-contact-general-edit"
                    @click="edit(GENERAL)"
                >
                    <span class="min-w-0 flex-1 basis-48">
                        <span
                            class="block truncate font-medium text-highlighted"
                        >
                            {{ $t('gymInfo.settings.generalContact') }}
                        </span>
                        <span
                            v-for="line in contactLines(
                                { email, phone },
                                $t('gymInfo.settings.noContact'),
                            )"
                            :key="line"
                            class="block truncate text-sm text-muted"
                        >
                            {{ line }}
                        </span>
                    </span>
                    <AdminGymContactUses
                        :uses="generalUses"
                        test-id="settings-contact-general-uses"
                    />
                </button>
                <UIcon
                    name="i-lucide-chevron-right"
                    class="me-3 size-4 text-muted"
                />
            </LayoutListRow>
            <LayoutListRow
                v-for="(contact, index) in model"
                :key="index"
                dense
                :icon="GYM_CONTACT_KINDS[contact.kind]"
                :data-testid="`settings-contact-${index}`"
            >
                <button
                    type="button"
                    class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-start"
                    :data-testid="`settings-contact-${index}-edit`"
                    @click="edit(index)"
                >
                    <span class="min-w-0 flex-1 basis-48">
                        <span
                            class="block truncate font-medium text-highlighted"
                        >
                            {{ contactTitle(contact) }}
                        </span>
                        <span
                            v-for="line in contactLines(contact)"
                            :key="line"
                            class="block truncate text-sm text-muted"
                        >
                            {{ line }}
                        </span>
                    </span>
                    <AdminGymContactUses
                        :uses="roleContactUses(model, index)"
                        :test-id="`settings-contact-${index}-uses`"
                    />
                </button>
                <UIcon
                    name="i-lucide-chevron-right"
                    class="me-3 size-4 text-muted"
                />
            </LayoutListRow>
        </LayoutListGroup>
        <div v-if="model.length < GYM_MAX_CONTACTS" class="p-4 pt-3">
            <UButton
                icon="i-lucide-plus"
                color="neutral"
                variant="outline"
                :label="$t('gymInfo.settings.addContact')"
                data-testid="settings-contact-add"
                @click="edit(model.length)"
            />
        </div>

        <LayoutDialogShell
            v-model="open"
            :title="dialogTitle"
            sheet-on-mobile
            closable
            :submit-label="$t('actions.save')"
            submit-icon="i-lucide-check"
            :submit-disabled="!valid"
            submit-test-id="contact-dialog-submit"
            cancel-test-id="contact-dialog-cancel"
            data-testid="contact-dialog"
            @submit="save"
        >
            <div class="flex flex-col gap-4">
                <OptionGrid
                    v-if="!editingGeneral"
                    v-model="draft.kind"
                    :items="kindItems"
                    :label="$t('gymInfo.settings.contactKind')"
                    cols="grid-cols-2 sm:grid-cols-3"
                    test-id-prefix="contact-dialog-kind"
                />
                <UFormField
                    v-if="!editingGeneral && draft.kind === 'other'"
                    :label="$t('gymInfo.settings.contactLabel')"
                >
                    <UInput
                        v-model="draft.label"
                        :placeholder="$t('gymInfo.contactKinds.other')"
                        :maxlength="GYM_CONTACT_LABEL_MAX"
                        class="w-full"
                        data-testid="contact-dialog-label"
                    />
                </UFormField>
                <UFormField
                    v-if="!editingGeneral"
                    :label="$t('gymInfo.settings.contactName')"
                >
                    <UInput
                        v-model="draft.name"
                        icon="i-lucide-user-round"
                        :maxlength="GYM_CONTACT_NAME_MAX"
                        class="w-full"
                        data-testid="contact-dialog-name"
                    />
                </UFormField>
                <UFormField
                    :label="$t('gymInfo.settings.contactEmail')"
                    :error="emailError"
                >
                    <UInput
                        v-model="draft.email"
                        type="email"
                        icon="i-lucide-mail"
                        class="w-full"
                        data-testid="contact-dialog-email"
                    />
                </UFormField>
                <UFormField :label="$t('gymInfo.settings.contactPhone')">
                    <UInput
                        v-model="draft.phone"
                        type="tel"
                        icon="i-lucide-phone"
                        :maxlength="GYM_CONTACT_PHONE_MAX"
                        class="w-full"
                        data-testid="contact-dialog-phone"
                    />
                </UFormField>
                <UFormField
                    v-if="draftUses.length"
                    :label="$t('gymInfo.settings.contactUses')"
                >
                    <AdminGymContactUses
                        :uses="draftUses"
                        test-id="contact-dialog-uses"
                    />
                </UFormField>
            </div>
            <template
                v-if="editing >= 0 && editing < model.length"
                #footer-start
            >
                <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    :label="$t('gymInfo.settings.removeContact')"
                    data-testid="contact-dialog-remove"
                    @click="remove"
                />
            </template>
        </LayoutDialogShell>
    </div>
</template>

<script setup lang="ts">
import {
    GYM_CONTACT_KINDS,
    GYM_CONTACT_KIND_KEYS,
    GYM_CONTACT_LABEL_MAX,
    GYM_CONTACT_NAME_MAX,
    GYM_CONTACT_PHONE_MAX,
    GYM_MAX_CONTACTS,
    isValidGymContacts,
} from '#shared/utils/gymContacts'
import {
    contactLines,
    generalContactUses,
    roleContactUses,
} from '~/utils/gymContactUses'
import {
    contactsPayload,
    emptyContact,
    type GymContactDraft,
} from '~/utils/gymSettingsDraft'

const GENERAL = -1

const model = defineModel<GymContactDraft[]>({ required: true })
const email = defineModel<string>('email', { required: true })
const phone = defineModel<string>('phone', { required: true })

const { t } = useI18n()
const kindItems = computed(() =>
    GYM_CONTACT_KIND_KEYS.map((kind) => ({
        value: kind,
        label: t(`gymInfo.contactKinds.${kind}`),
        icon: GYM_CONTACT_KINDS[kind],
    })),
)

const generalUses = computed(() =>
    generalContactUses({ email: email.value, phone: phone.value }, model.value),
)

const open = ref(false)
const editing = ref(0)
const draft = ref<GymContactDraft>(emptyContact())
const editingGeneral = computed(() => editing.value === GENERAL)

const dialogTitle = computed(() =>
    editingGeneral.value
        ? t('gymInfo.settings.generalContact')
        : t(
              editing.value < model.value.length
                  ? 'gymInfo.settings.editContact'
                  : 'gymInfo.settings.addContact',
          ),
)

function edit(index: number) {
    editing.value = index
    draft.value =
        index === GENERAL
            ? { ...emptyContact(), email: email.value, phone: phone.value }
            : { ...(model.value[index] ?? emptyContact()) }
    open.value = true
}

const contactsWithDraft = computed(() => {
    const contacts = [...model.value]
    contacts.splice(editing.value, 1, draft.value)
    return contacts
})
const draftUses = computed(() =>
    editingGeneral.value
        ? generalContactUses(draft.value, model.value)
        : roleContactUses(contactsWithDraft.value, editing.value),
)

const emailValid = computed(
    () =>
        !draft.value.email.trim() ||
        isValidGymContacts([
            { kind: 'other', email: draft.value.email.trim() },
        ]),
)
const payload = computed(() => contactsPayload([draft.value]))
const valid = computed(() =>
    editingGeneral.value
        ? emailValid.value
        : !!(draft.value.email.trim() || draft.value.phone.trim()) &&
          isValidGymContacts(payload.value),
)
const emailError = computed(() =>
    emailValid.value ? undefined : t('validation.email'),
)

function contactTitle(contact: GymContactDraft) {
    return [
        (contact.kind === 'other' && contact.label) ||
            t(`gymInfo.contactKinds.${contact.kind}`),
        contact.name,
    ]
        .filter(Boolean)
        .join(' – ')
}

function save() {
    if (!valid.value) return
    if (editingGeneral.value) {
        email.value = draft.value.email.trim()
        phone.value = draft.value.phone.trim()
    } else {
        model.value.splice(editing.value, 1, {
            ...emptyContact(),
            ...payload.value[0]!,
        })
    }
    open.value = false
}

function remove() {
    model.value.splice(editing.value, 1)
    open.value = false
}
</script>
