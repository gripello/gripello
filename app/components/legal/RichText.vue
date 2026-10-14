<script setup lang="ts">
import { h, resolveComponent, type VNodeChild } from 'vue'
import type { RichBlock, RichInline } from '~/utils/legalRichText'

const props = defineProps<{ blocks?: RichBlock[]; inline?: RichInline[] }>()

const ULink = resolveComponent('ULink')

function renderInline(nodes: RichInline[]): VNodeChild[] {
    return nodes.map((node) => {
        switch (node.type) {
            case 'text':
                return node.text
            case 'br':
                return h('br')
            case 'link':
                return h(
                    ULink,
                    {
                        raw: true,
                        to: node.href,
                        external: !node.href.startsWith('/'),
                        target: node.href.startsWith('http')
                            ? '_blank'
                            : undefined,
                    },
                    () => renderInline(node.children),
                )
            default:
                return h(node.type, renderInline(node.children))
        }
    })
}

function renderBlocks(blocks: RichBlock[]): VNodeChild[] {
    return blocks.map((block) =>
        'items' in block
            ? h(
                  block.type,
                  block.items.map((item) => h('li', renderBlocks(item))),
              )
            : h(block.type, renderInline(block.children)),
    )
}

const render = () =>
    props.inline ? renderInline(props.inline) : renderBlocks(props.blocks ?? [])
</script>

<template>
    <component :is="render" />
</template>
