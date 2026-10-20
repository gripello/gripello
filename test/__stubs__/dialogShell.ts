export const dialogShellStub = {
    props: {
        modelValue: Boolean,
        title: String,
        submitLabel: String,
        submitDisabled: Boolean,
        submitLoading: Boolean,
        submitTestId: String,
        cancelTestId: String,
        captcha: Boolean,
        onCancel: Function,
    },
    emits: ['update:modelValue', 'submit'],
    template: `<div>
        <slot name="header" />
        <slot />
        <slot name="actions">
            <button
                :data-testid="cancelTestId"
                @click="onCancel ? onCancel() : $emit('update:modelValue', false)"
            >actions.cancel</button>
            <slot name="footer-start" />
            <button
                :data-testid="submitTestId"
                :disabled="submitDisabled || (captcha && submitLoading)"
                @click="$emit('submit')"
            >{{ submitLabel }}</button>
        </slot>
    </div>`,
}
