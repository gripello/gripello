import { mount } from '@vue/test-utils'
import TopEdge from '~/components/layout/TopEdge.vue'

describe('TopEdge', () => {
    it('spans the full viewport width above header and sidebar from lg up, invisible and click-through', () => {
        const classes = mount(TopEdge)
            .find('[data-testid="top-edge"]')
            .classes()

        expect(classes).toEqual(
            expect.arrayContaining([
                'fixed',
                'inset-x-0',
                'top-0',
                'z-50',
                'h-1.5',
                'bg-default',
                'opacity-0',
                'pointer-events-none',
                'hidden',
                'lg:block',
            ]),
        )
    })
})
