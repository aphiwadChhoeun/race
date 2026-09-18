import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { pipTotal, type DieFaces, type Face } from './faces'
import { AXES, PIP_LAYOUT, faceBasis, type Labeling } from './labeling'
import { DIE_HALF, FPS, TABLE_HALF, readFrame, type Recording } from './physics'
import { scheduleImpacts } from './sound'

/**
 * Renders the table and replays a recorded throw.
 *
 * This component holds no physics. It samples the transform track produced by
 * physics.ts, which means a slow frame costs a little smoothness and nothing
 * else — there is no integration to fall behind, and the dice cannot end up
 * somewhere other than where the simulation said they would.
 */

const PIP_RADIUS = 0.078
/** Pip layout coordinates are in [-1, 1]; this maps them into the face. */
const PIP_SPREAD = 0.5
/** A cross is two bars at right angles, sized to sit inside the pip footprint. */
const BAR_LENGTH = 0.6
const BAR_WIDTH = 0.11
const BAR_DEPTH = 0.06
/** Bars per cross face, and cross faces are the only thing that needs them. */
const BARS_PER_CROSS = 2

type DieView = {
  group: THREE.Group
  pips: THREE.Mesh[]
  bars: THREE.Mesh[]
}

type Stage = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  dice: DieView[]
  dieGeometry: THREE.BufferGeometry
  pipGeometry: THREE.BufferGeometry
  barGeometry: THREE.BufferGeometry
  materials: THREE.Material[]
  disposed: boolean
}

export type DiceTableProps = {
  recording: Recording | null
  /** 0 shows the recording's final pose; bump it to replay the throw. */
  playId: number
  volume?: number
  onSettle?: () => void
  /** Body colour per die, defaulting to bone white. */
  dieColors?: number[]
}

export function DiceTable({ recording, playId, volume = 0.45, onSettle, dieColors }: DiceTableProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Stage | null>(null)
  const onSettleRef = useRef(onSettle)
  onSettleRef.current = onSettle
  const volumeRef = useRef(volume)
  volumeRef.current = volume

  // --- Scene: built once ---------------------------------------------------
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    host.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'

    const scene = new THREE.Scene()
    // Elevated ~46°: high enough to read the top faces without foreshortening
    // them, low enough that the dice keep visible sides and cast their shadows
    // out to the side rather than straight down underneath themselves. The
    // distance is set together with the launch parameters in physics.ts — see
    // the note there; the pair keeps the whole flight on screen down to a 1.1
    // aspect ratio.
    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100)
    camera.position.set(0.2, 6.4, 6.2)
    camera.lookAt(0, 0.1, 0)

    // Lighting: one strong key light casting the shadows, plus a cool
    // hemisphere fill so the shadowed faces don't go black.
    scene.add(new THREE.HemisphereLight(0x9fc4e8, 0x2c3a2c, 0.55))
    const key = new THREE.DirectionalLight(0xfff4e2, 2.4)
    key.position.set(4.5, 9, 3.5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 24
    // Tight shadow frustum around the table keeps the texels small and the
    // contact shadows crisp.
    const extent = TABLE_HALF + 0.8
    key.shadow.camera.left = -extent
    key.shadow.camera.right = extent
    key.shadow.camera.top = extent
    key.shadow.camera.bottom = -extent
    key.shadow.bias = -0.0008
    key.shadow.normalBias = 0.02
    // Required: three won't recompute the shadow camera's projection for us, so
    // without this the frustum above is ignored and the default ±5 is used,
    // spreading the same 2048 texels over a wider area for softer shadows.
    key.shadow.camera.updateProjectionMatrix()
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xbcd4ff, 0.5)
    rim.position.set(-5, 3, -4)
    scene.add(rim)

    const materials: THREE.Material[] = []

    // The floor and the four rails are physics-only — they live in physics.ts
    // and are deliberately not drawn, so the dice roll and rebound on an
    // invisible table and whatever is behind the canvas shows through.
    //
    // What does get drawn here is a shadow catcher: a plane carrying
    // ShadowMaterial, which renders *only* where a shadow falls and is fully
    // transparent everywhere else. Without it the dice lose their contact
    // shadows entirely and read as floating in a void rather than resting on
    // something. It is the shadow, not the surface, that grounds them.
    //
    // Because it composites onto whatever is behind the canvas, it reads
    // strongly on a light background and barely at all on a dark one. To drop
    // shadows altogether, remove this block and set shadowMap.enabled = false.
    const shadowMaterial = new THREE.ShadowMaterial({ opacity: 0.38 })
    materials.push(shadowMaterial)
    const catcher = new THREE.Mesh(
      // Matched to the shadow camera's frustum: a die resting against a rail
      // throws its shadow past the table edge, so the catcher has to reach
      // beyond the table — but reaching past `extent` would be dead area, since
      // nothing outside the frustum casts a shadow in the first place.
      new THREE.PlaneGeometry(extent * 2, extent * 2),
      shadowMaterial,
    )
    catcher.rotation.x = -Math.PI / 2
    catcher.receiveShadow = true
    scene.add(catcher)

    // Die body: rounded corners are most of what separates a real die from a
    // cube, both in silhouette and in the highlight that runs along the edge.
    const dieGeometry = new RoundedBoxGeometry(DIE_HALF * 2, DIE_HALF * 2, DIE_HALF * 2, 4, 0.12)
    const pipGeometry = new THREE.SphereGeometry(PIP_RADIUS, 16, 12)
    const barGeometry = new THREE.BoxGeometry(BAR_LENGTH, BAR_WIDTH, BAR_DEPTH)

    const stage: Stage = {
      renderer,
      scene,
      camera,
      dice: [],
      dieGeometry,
      pipGeometry,
      barGeometry,
      materials,
      disposed: false,
    }
    stageRef.current = stage

    const resize = () => {
      const { clientWidth, clientHeight } = host
      if (clientWidth === 0 || clientHeight === 0) return
      renderer.setSize(clientWidth, clientHeight, false)
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    return () => {
      stage.disposed = true
      observer.disconnect()
      dieGeometry.dispose()
      pipGeometry.dispose()
      barGeometry.dispose()
      for (const material of materials) material.dispose()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement)
      stageRef.current = null
    }
  }, [])

  // --- Dice: rebuilt only when the number of dice changes -----------------
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !recording) return
    if (stage.dice.length === recording.dieCount) return

    for (const die of stage.dice) stage.scene.remove(die.group)
    stage.dice = []

    const pipMaterial = new THREE.MeshStandardMaterial({
      color: 0x191920,
      roughness: 0.45,
      metalness: 0.05,
    })
    // Crosses are the bust mark, so they read in red rather than pip-black.
    const barMaterial = new THREE.MeshStandardMaterial({
      color: 0xb3382f,
      roughness: 0.4,
      metalness: 0.05,
    })
    stage.materials.push(pipMaterial, barMaterial)

    for (let i = 0; i < recording.dieCount; i++) {
      const faces = recording.dice[i]
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: dieColors?.[i] ?? 0xf4eee2,
        roughness: 0.34,
        metalness: 0.02,
      })
      stage.materials.push(bodyMaterial)

      const group = new THREE.Group()
      const body = new THREE.Mesh(stage.dieGeometry, bodyMaterial)
      body.castShadow = true
      body.receiveShadow = true
      group.add(body)

      const pips: THREE.Mesh[] = []
      for (let p = 0; p < pipTotal(faces); p++) {
        const pip = new THREE.Mesh(stage.pipGeometry, pipMaterial)
        // Pips don't cast shadows: at this scale the maps only produce speckle.
        pip.castShadow = false
        group.add(pip)
        pips.push(pip)
      }

      const crossFaces = faces.filter((face) => face === 'x').length
      const bars: THREE.Mesh[] = []
      for (let b = 0; b < crossFaces * BARS_PER_CROSS; b++) {
        const bar = new THREE.Mesh(stage.barGeometry, barMaterial)
        bar.castShadow = false
        group.add(bar)
        bars.push(bar)
      }

      stage.scene.add(group)
      stage.dice.push({ group, pips, bars })
    }
  }, [recording, dieColors])

  // --- Pips: repositioned whenever the labeling changes -------------------
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !recording) return
    recording.outcomes.forEach((outcome, index) => {
      const die = stage.dice[index]
      if (die) applyFaces(die, outcome.labeling, recording.dice[index])
    })
  }, [recording])

  // --- Playback ------------------------------------------------------------
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !recording || recording.frameCount === 0) return

    // Scratch objects, hoisted out of the frame loop: this runs 60 times a
    // second per die, and allocating there is how you get GC hitches mid-roll.
    const slot = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 }
    const a = new THREE.Quaternion()
    const b = new THREE.Quaternion()
    const nextPosition = new THREE.Vector3()

    const showFrame = (frame: number) => {
      const lower = Math.floor(frame)
      const alpha = frame - lower
      for (let i = 0; i < recording.dieCount; i++) {
        const die = stage.dice[i]
        if (!die) continue
        readFrame(recording, lower, i, slot)
        die.group.position.set(slot.px, slot.py, slot.pz)
        a.set(slot.qx, slot.qy, slot.qz, slot.qw)
        if (alpha > 0 && lower + 1 < recording.frameCount) {
          readFrame(recording, lower + 1, i, slot)
          b.set(slot.qx, slot.qy, slot.qz, slot.qw)
          nextPosition.set(slot.px, slot.py, slot.pz)
          die.group.position.lerp(nextPosition, alpha)
          a.slerp(b, alpha)
        }
        die.group.quaternion.copy(a)
      }
      stage.renderer.render(stage.scene, stage.camera)
    }

    const finalFrame = recording.frameCount - 1
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    // playId 0 is the initial pose, not a throw.
    if (playId === 0 || reduceMotion) {
      showFrame(finalFrame)
      if (playId !== 0) onSettleRef.current?.()
      return
    }

    scheduleImpacts(recording.impacts, volumeRef.current)

    let raf = 0
    let settled = false
    const start = performance.now()

    const tick = (now: number) => {
      if (stage.disposed) return
      const elapsed = (now - start) / 1000
      if (elapsed >= recording.duration) {
        showFrame(finalFrame)
        settled = true
        onSettleRef.current?.()
        return
      }
      showFrame(elapsed * FPS)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      if (settled) return
      // Interrupted: show the outcome it was heading for, so the dice on screen
      // always agree with the value the game has already recorded, and report
      // the settle anyway. Without this an interrupted throw never resolves and
      // the tray stays `rolling` forever, blocking every later roll. `settle()`
      // is idempotent, so the replacement playback reporting in turn is a no-op.
      showFrame(finalFrame)
      onSettleRef.current?.()
    }
  }, [playId, recording])

  return <div className="dice-table" ref={hostRef} />
}

/**
 * Places pips and cross-bars according to which face id sits on which axis.
 *
 * A die only carries as many pips as its faces need, and only the faces it
 * actually has, so anything left over from a previous dressing is hidden rather
 * than abandoned in place.
 */
function applyFaces(die: DieView, labeling: Labeling, faces: DieFaces) {
  let pipCursor = 0
  let barCursor = 0
  // Sit the marks slightly proud of the surface, like an inlaid spot.
  const pipDepth = DIE_HALF - 0.035
  const barDepth = DIE_HALF - 0.012

  for (let axisIndex = 0; axisIndex < AXES.length; axisIndex++) {
    const axis = AXES[axisIndex]
    const face: Face = faces[labeling[axisIndex] - 1]
    const { u, v } = faceBasis(axis)

    const place = (mesh: THREE.Mesh, depth: number, du: number, dv: number) => {
      mesh.position.set(
        axis[0] * depth + u[0] * du * PIP_SPREAD + v[0] * dv * PIP_SPREAD,
        axis[1] * depth + u[1] * du * PIP_SPREAD + v[1] * dv * PIP_SPREAD,
        axis[2] * depth + u[2] * du * PIP_SPREAD + v[2] * dv * PIP_SPREAD,
      )
      mesh.visible = true
    }

    if (face === 'x') {
      // The face's own basis, so the bars lie in its plane whatever axis it is.
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(u[0], u[1], u[2]),
        new THREE.Vector3(v[0], v[1], v[2]),
        new THREE.Vector3(axis[0], axis[1], axis[2]),
      )
      for (const angle of [Math.PI / 4, -Math.PI / 4]) {
        const bar = die.bars[barCursor++]
        if (!bar) break
        place(bar, barDepth, 0, 0)
        bar.setRotationFromMatrix(basis)
        bar.rotateZ(angle)
      }
      continue
    }

    for (const [du, dv] of PIP_LAYOUT[face]) {
      const pip = die.pips[pipCursor++]
      if (!pip) break
      place(pip, pipDepth, du, dv)
    }
  }

  for (let i = pipCursor; i < die.pips.length; i++) die.pips[i].visible = false
  for (let i = barCursor; i < die.bars.length; i++) die.bars[i].visible = false
}
