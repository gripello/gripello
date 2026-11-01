import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef, useTemplateRef } from 'vue'
import QrStream from '~/components/qr/Stream.vue'

class FakeWorker {
    static instances: FakeWorker[] = []
    posted: { formats: string[]; pixels: { width: number } }[] = []
    terminated = false
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: ((event: { message: string }) => void) | null = null
    constructor() {
        FakeWorker.instances.push(this)
    }
    postMessage(message: never) {
        this.posted.push(message)
    }
    terminate() {
        this.terminated = true
    }
    reply(codes: string[], followed: string[] = []) {
        const code = (rawValue: string) => ({
            rawValue,
            boundingBox: { x: 10, y: 20, width: 30, height: 40 },
        })
        this.onmessage!({
            data: { codes: codes.map(code), followed: followed.map(code) },
        })
    }
}

let frames: FrameRequestCallback[] = []
let track: { stop: ReturnType<typeof vi.fn> }
let getUserMedia: ReturnType<typeof vi.fn>
let secure = true
const srcObject = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'srcObject',
)!

beforeEach(() => {
    FakeWorker.instances = []
    frames = []
    secure = true
    track = { stop: vi.fn() }
    const stream = {
        getTracks: () => [track],
        getVideoTracks: () => [{ getCapabilities: () => ({ torch: true }) }],
    }
    getUserMedia = vi.fn(async () => stream)
    vi.stubGlobal('useTemplateRef', useTemplateRef)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
        frames.push(frame)
        return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        get: () => secure,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia },
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: () => {},
        getImageData: (
            _x: number,
            _y: number,
            width: number,
            height: number,
        ) => ({
            data: new Uint8ClampedArray(4),
            width,
            height,
        }),
        measureText: (text: string) => ({ width: text.length * 8 }),
        font: '',
    } as never)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
        configurable: true,
        writable: true,
        value: null,
    })
})

afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', srcObject)
})

async function start(props: Record<string, unknown> = {}) {
    const wrapper = mount(QrStream, {
        props: {
            formats: ['QRCode'],
            constraints: { facingMode: 'environment' },
            ...props,
        },
    })
    const video = wrapper.get('video').element as HTMLVideoElement
    for (const [key, value] of Object.entries({
        readyState: 4,
        videoWidth: 2560,
        videoHeight: 1440,
        offsetWidth: 1280,
        offsetHeight: 720,
    }))
        Object.defineProperty(video, key, { configurable: true, value })
    await flushPromises()
    video.dispatchEvent(new Event('loadeddata'))
    await flushPromises()
    return { wrapper, video }
}

const runFrames = () => {
    const pending = frames
    frames = []
    pending.forEach((frame) => frame(performance.now()))
}

describe('QrStream', () => {
    it('opens the requested camera and hands downscaled frames to the decoder', async () => {
        const { wrapper } = await start()
        expect(getUserMedia).toHaveBeenCalledWith({
            audio: false,
            video: { facingMode: 'environment' },
        })
        expect(wrapper.emitted('error')).toBeUndefined()
        expect(wrapper.emitted('camera-on')).toEqual([[{ torch: true }]])
        const [decoder] = FakeWorker.instances
        expect(decoder!.posted).toHaveLength(1)
        expect(decoder!.posted[0]).toMatchObject({
            formats: ['QRCode'],
            pixels: { width: 1280 },
        })
    })

    it('reports codes in video coordinates and detects only codes that are new', async () => {
        const { wrapper } = await start()
        const decoder = FakeWorker.instances[0]!
        decoder.reply(['a'])
        expect(wrapper.emitted('frame')![0]).toEqual([
            [
                {
                    rawValue: 'a',
                    boundingBox: { x: 20, y: 40, width: 60, height: 80 },
                },
            ],
            { width: 2560, height: 1440 },
        ])
        expect(wrapper.emitted('detect')).toHaveLength(1)

        decoder.reply(['a'])
        decoder.reply([], ['a'])
        decoder.reply(['a'])
        expect(wrapper.emitted('detect')).toHaveLength(1)
        expect(wrapper.emitted('frame')).toHaveLength(4)

        decoder.reply(['a', 'b'])
        expect(wrapper.emitted('detect')).toHaveLength(2)
    })

    it('draws a tracking box tagged with the caller label', async () => {
        const { wrapper } = await start({
            tag: (value: string) => ({
                color: '#f00',
                label: `Route ${value}`,
            }),
        })
        FakeWorker.instances[0]!.reply(['r1'])
        runFrames()
        await wrapper.vm.$nextTick()
        const layer = wrapper.get('[data-testid="qr-tracking-layer"]')
        expect(layer.attributes('viewBox')).toBe('0 0 1280 720')
        expect(layer.text()).toBe('Route r1')
        expect(layer.find('rect').attributes('stroke')).toBe('#f00')
    })

    it('stops the camera and the decoder on unmount and ignores late results', async () => {
        const { wrapper, video } = await start()
        const decoder = FakeWorker.instances[0]!
        expect(video.srcObject).not.toBeNull()
        wrapper.unmount()
        expect(video.srcObject).toBeNull()
        expect(track.stop).toHaveBeenCalled()
        expect(decoder.terminated).toBe(true)
        decoder.reply(['a'])
        expect(wrapper.emitted('frame')).toBeUndefined()
    })

    it('releases a camera granted after the scanner was closed', async () => {
        let grant!: (stream: unknown) => void
        getUserMedia.mockReturnValue(
            new Promise((resolve) => (grant = resolve)),
        )
        const wrapper = mount(QrStream, {
            props: { formats: ['QRCode'], constraints: {} },
        })
        wrapper.unmount()
        grant({ getTracks: () => [track], getVideoTracks: () => [] })
        await flushPromises()
        expect(track.stop).toHaveBeenCalled()
        expect(wrapper.emitted('camera-on')).toBeUndefined()
        expect(wrapper.emitted('error')).toBeUndefined()
        expect(FakeWorker.instances).toHaveLength(0)
    })

    it('reports a denied camera and an insecure page without scanning', async () => {
        const denied = new DOMException('denied', 'NotAllowedError')
        getUserMedia.mockRejectedValue(denied)
        const { wrapper } = await start()
        expect(wrapper.emitted('error')).toEqual([[denied]])
        expect(FakeWorker.instances).toHaveLength(0)

        secure = false
        getUserMedia.mockClear()
        const insecure = (await start()).wrapper
        expect(getUserMedia).not.toHaveBeenCalled()
        expect((insecure.emitted('error')![0]![0] as Error).message).toContain(
            'secure context',
        )
    })

    it('turns the camera off when the decoder fails to load', async () => {
        const { wrapper } = await start()
        FakeWorker.instances[0]!.onerror!({ message: '' })
        expect(track.stop).toHaveBeenCalled()
        expect((wrapper.emitted('error')![0]![0] as Error).message).toBe(
            'QR decoder failed to load',
        )
    })
})

describe('QrStream camera load timeout', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    function mountWaiting() {
        const onError = vi.fn()
        const wrapper = mount(QrStream, {
            props: { formats: ['QRCode'], constraints: {}, onError },
        })
        return { wrapper, onError, video: wrapper.get('video').element }
    }

    it('gives up and turns the camera off when the stream never loads', async () => {
        const { wrapper, video } = mountWaiting()
        await flushPromises()
        vi.advanceTimersByTime(5999)
        await flushPromises()
        expect(wrapper.emitted('error')).toBeUndefined()
        expect(track.stop).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)
        await flushPromises()
        expect((wrapper.emitted('error')![0]![0] as Error).message).toBe(
            'Camera stream did not load',
        )
        expect(track.stop).toHaveBeenCalled()
        expect((video as HTMLVideoElement).srcObject).toBeNull()
        expect(wrapper.emitted('camera-on')).toBeUndefined()
        expect(FakeWorker.instances).toHaveLength(0)
    })

    it('raises no timeout once the stream loaded in time', async () => {
        const { wrapper, video } = mountWaiting()
        await flushPromises()
        vi.advanceTimersByTime(3000)
        video.dispatchEvent(new Event('loadeddata'))
        await flushPromises()
        vi.advanceTimersByTime(10_000)
        await flushPromises()
        expect(wrapper.emitted('camera-on')).toHaveLength(1)
        expect(wrapper.emitted('error')).toBeUndefined()
        expect(track.stop).not.toHaveBeenCalled()
    })

    it('stays quiet when closed before the timeout', async () => {
        const { wrapper, onError } = mountWaiting()
        await flushPromises()
        wrapper.unmount()
        expect(track.stop).toHaveBeenCalledOnce()
        vi.advanceTimersByTime(6000)
        await flushPromises()
        expect(onError).not.toHaveBeenCalled()
        expect(wrapper.emitted('camera-on')).toBeUndefined()
        expect(FakeWorker.instances).toHaveLength(0)
    })
})
