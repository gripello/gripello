import { haptic } from '~/utils/haptics'
import type { Ref } from 'vue'

interface CameraError {
    name?: string
    message?: string
}

export function useQrScanner(
    viewport: Readonly<Ref<HTMLElement | null>>,
    cameraErrorMessage: () => string,
) {
    const scanning = ref(false)
    const cameraActive = ref(false)
    const torchOn = ref(false)
    const torchSupported = ref(false)
    const scannerError = ref('')

    let audioContext: AudioContext | null = null

    const ensureAudio = () => {
        try {
            audioContext ||= new (
                window.AudioContext ||
                (
                    window as unknown as {
                        webkitAudioContext: typeof AudioContext
                    }
                ).webkitAudioContext
            )()
            if (audioContext.state === 'suspended') void audioContext.resume()
        } catch {
            audioContext = null
        }
    }

    const beep = (frequency: number, duration = 0.12) => {
        if (!audioContext) return
        try {
            const now = audioContext.currentTime
            const oscillator = audioContext.createOscillator()
            const gain = audioContext.createGain()
            oscillator.type = 'sine'
            oscillator.frequency.value = frequency
            gain.gain.setValueAtTime(0.0001, now)
            gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01)
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
            oscillator.connect(gain)
            gain.connect(audioContext.destination)
            oscillator.start(now)
            oscillator.stop(now + duration)
        } catch {}
    }

    const signalAccepted = () => {
        void haptic('success')
        beep(880)
    }

    const signalDuplicate = () => {
        void haptic('warning')
        beep(520)
    }

    const signalRejected = () => {
        void haptic('error')
        beep(220, 0.2)
    }

    const videoTrack = (): MediaStreamTrack | null => {
        const stream = viewport.value?.querySelector('video')
            ?.srcObject as MediaStream | null
        return stream?.getVideoTracks()[0] ?? null
    }

    const toggleTorch = async () => {
        const track = videoTrack()
        if (!track) return
        const next = !torchOn.value
        try {
            await track.applyConstraints({
                advanced: [
                    { torch: next } as unknown as MediaTrackConstraintSet,
                ],
            })
            torchOn.value = next
        } catch (error) {
            console.error('Failed to toggle the torch:', error)
            torchSupported.value = false
        }
    }

    const onCameraOn = (capabilities: Partial<MediaTrackCapabilities>) => {
        scanning.value = true
        scannerError.value = ''
        torchSupported.value = !!capabilities && 'torch' in capabilities
    }

    const stop = () => {
        cameraActive.value = false
        scanning.value = false
        torchOn.value = false
        torchSupported.value = false
    }

    const onCameraError = (error: CameraError) => {
        console.error('Camera error:', error)
        stop()
        scannerError.value = cameraErrorMessage()
    }

    const start = () => {
        if (!import.meta.client) return
        if (navigator.userActivation?.isActive) ensureAudio()
        else window.addEventListener('pointerdown', ensureAudio, { once: true })
        scannerError.value = ''
        cameraActive.value = true
    }

    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden' && cameraActive.value) stop()
    }

    onMounted(() =>
        document.addEventListener('visibilitychange', onVisibilityChange),
    )

    onBeforeUnmount(() => {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        window.removeEventListener('pointerdown', ensureAudio)
        stop()
        void audioContext?.close()
        audioContext = null
    })

    return {
        scanning,
        cameraActive,
        torchOn,
        torchSupported,
        scannerError,
        start,
        stop,
        toggleTorch,
        onCameraOn,
        onCameraError,
        signalAccepted,
        signalDuplicate,
        signalRejected,
    }
}
