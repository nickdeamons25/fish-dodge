/** Keyboard + pointer state, polled by the game each frame. */
export class Input {
  private down = new Set<string>()
  /** Pointer position in canvas CSS pixels, and whether it's held. */
  pointer = { x: 0, y: 0, isDown: false }
  private listeners: [EventTarget, string, EventListener][] = []

  constructor(private canvas: HTMLCanvasElement) {
    this.on(window, 'keydown', (e) => {
      const ke = e as KeyboardEvent
      if ((ke.target as HTMLElement)?.tagName === 'INPUT') return
      this.down.add(ke.code)
      if (ke.code.startsWith('Arrow')) ke.preventDefault()
    })
    this.on(window, 'keyup', e => this.down.delete((e as KeyboardEvent).code))
    this.on(window, 'blur', () => this.down.clear())

    const move = (e: Event) => {
      const pe = e as PointerEvent
      const r = this.canvas.getBoundingClientRect()
      this.pointer.x = pe.clientX - r.left
      this.pointer.y = pe.clientY - r.top
    }
    this.on(canvas, 'pointerdown', (e) => {
      move(e)
      this.pointer.isDown = true
      canvas.setPointerCapture((e as PointerEvent).pointerId)
    })
    this.on(canvas, 'pointermove', move)
    this.on(canvas, 'pointerup', () => (this.pointer.isDown = false))
    this.on(canvas, 'pointercancel', () => (this.pointer.isDown = false))
  }

  isDown(...codes: string[]) {
    return codes.some(c => this.down.has(c))
  }

  destroy() {
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn)
    this.listeners = []
  }

  private on(target: EventTarget, type: string, fn: EventListener) {
    target.addEventListener(type, fn)
    this.listeners.push([target, type, fn])
  }
}
