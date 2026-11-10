import { memo } from 'react'
import { RANGES, type Settings } from '../lib/settings'
import { formatLength } from '../lib/units'
import { Button, DraftNumber, LengthField, NumberField, Section, Segmented, SliderField, SwitchField, type Option } from './Controls'
import type { Placement } from '../voronoi/seeding'
import type { DensityMode } from '../voronoi/density'

export type Change = (patch: Partial<Settings>, key?: string) => void

const PLACEMENTS: Option<Placement>[] = [
  { value: 'random', label: 'Azar', tip: 'Los puntos se ubican al azar; las celdas varían de tamaño y pueden agruparse.' },
  { value: 'even', label: 'Uniforme', tip: 'La distribución de Poisson mantiene una distancia mínima entre puntos para repartir las celdas de forma uniforme y natural.' },
  { value: 'hex', label: 'Hex.', tip: 'Los puntos en una cuadrícula hexagonal forman un panal. Aumenta la irregularidad para darle un aspecto más natural.' },
  { value: 'square', label: 'Cuadrada', tip: 'Los puntos en una cuadrícula cuadrada forman celdas cuadradas. Aumenta la irregularidad para darle un aspecto más natural.' },
]
const PLACEMENT_HINT: Record<Placement, string> = {
  random: 'Azar: los puntos pueden caer en cualquier lugar; algunas celdas son grandes y otras se agrupan.',
  even: 'Uniforme: mantiene una separación mínima para repartir las celdas sin perder el aspecto natural.',
  hex: 'Hexagonal: una cuadrícula de panal. La irregularidad desplaza un poco los puntos para darle un aspecto más natural.',
  square: 'Cuadrada: una cuadrícula de cuadrados. La irregularidad desplaza un poco los puntos para darle un aspecto más natural.',
}
const DENSITIES: Option<DensityMode>[] = [
  { value: 'none', label: 'Ninguno', tip: 'Las celdas tienen tamaños similares en toda la lámina.' },
  { value: 'linear', label: 'Lineal', tip: 'Las celdas se hacen más pequeñas hacia un lado de la lámina.' },
  { value: 'radial', label: 'Radial', tip: 'Las celdas se hacen más pequeñas hacia el centro o hacia el borde.' },
]

// Memoised: the panel only re-renders when its own props change, not on every relax step.
export const PatternPanel = memo(function PatternPanel({ s, change, stale, onApply, actualCount, autoSpacingValue, exactSpacing, capped, onShuffle }: {
  s: Settings; change: Change; stale: boolean; onApply: () => void; actualCount: number; autoSpacingValue: number
  exactSpacing: () => number; capped: boolean; onShuffle: () => void
}) {
  const grid = s.placement === 'hex' || s.placement === 'square'
  const spacingOff = s.placement === 'random' && 'La distribución al azar no permite ajustar la separación.'
  const countLocked = !s.autoSpacing && s.placement !== 'random' && 'La separación determina la cantidad. Activa Separación automática para elegir la cantidad.'
  const densityOff = grid && 'Los gradientes funcionan con Azar y Uniforme. Las cuadrículas mantienen su regularidad.'
  return <>
    {stale && <div className="notice" role="status">
      <p>Editaste puntos a mano; los nuevos ajustes del patrón aún no se aplicaron.</p>
      <Button className="primary wide" tip="Crea un patrón con estos ajustes. Reemplaza tus ediciones manuales; puedes recuperarlas con Deshacer." onClick={onApply}>Aplicar ajustes…</Button>
    </div>}

    <Section title="Puntos">
      <div className="field count-field" data-tip={countLocked || 'Cantidad de celdas que se crearán. Las cuadrículas la ajustan a filas completas.'}>
        <span className="field-label">
          <span id="count-label">Celdas</span>
          <DraftNumber className="number-input inline-number" labelledBy="count-label" min={RANGES.count[0]} max={RANGES.count[1]}
            value={s.count} disabled={Boolean(countLocked)} onChange={v => change({ count: Math.round(v) }, 'count')} />
        </span>
        <input type="range" aria-labelledby="count-label" min={Math.log(RANGES.count[0])} max={Math.log(RANGES.count[1])} step="any" value={Math.log(s.count)}
          disabled={Boolean(countLocked)} aria-valuetext={`${s.count} celdas`}
          style={{ '--fill': `${((Math.log(s.count) - Math.log(RANGES.count[0])) / (Math.log(RANGES.count[1]) - Math.log(RANGES.count[0])) * 100).toFixed(1)}%` } as React.CSSProperties}
          onChange={event => change({ count: Math.round(Math.exp(Number(event.currentTarget.value))) }, 'count')} />
      </div>
      {(grid || countLocked || capped) && <p className="hint">{capped ? 'Se alcanzó el límite de 20 000 puntos. Aumenta la separación.' : `${actualCount.toLocaleString()} celdas creadas.`}</p>}

      <Segmented label="Distribución" options={PLACEMENTS} value={s.placement} onChange={placement => change({ placement }, 'placement')} />
      <p className="hint">{PLACEMENT_HINT[s.placement]}</p>

      <SwitchField label="Separación automática" checked={s.autoSpacing || s.placement === 'random'} unavailable={spacingOff}
        tip="Activado: la separación depende de la cantidad de celdas y del tamaño de la lámina. Desactivado: eliges la separación y se calcula la cantidad."
        onChange={autoSpacing => change(autoSpacing ? { autoSpacing } : { autoSpacing, spacing: +exactSpacing().toFixed(4) }, 'autoSpacing')} />
      <LengthField label={s.placement === 'even' ? 'Separación mínima' : 'Paso de cuadrícula'} mm={s.autoSpacing ? autoSpacingValue : s.spacing}
        min={RANGES.spacing[0]} max={RANGES.spacing[1]} units={s.units} dpi={s.dpi} small
        unavailable={spacingOff || (s.autoSpacing && `La separación automática usa unos ${formatLength(autoSpacingValue, s.units, s.dpi, true)} para esta cantidad. Desactívala para elegir otro valor.`)}
        tip={s.placement === 'even' ? 'Distancia mínima entre puntos en la zona menos densa del gradiente.' : 'Distancia entre puntos vecinos de la cuadrícula.'}
        onChange={spacing => change({ spacing }, 'spacing')} />
      <SliderField label="Irregularidad" value={Math.round(s.jitter * 100)} min={0} max={100} format={v => `${v} %`}
        unavailable={!grid && 'La irregularidad solo se aplica a las cuadrículas hexagonal y cuadrada.'}
        tip="Cuánto puede desplazarse cada punto de la cuadrícula, como proporción de la mitad de la separación." onChange={v => change({ jitter: v / 100 }, 'jitter')} />

      <details className="more">
        <summary data-tip="Número de semilla e intentos del muestreo de Poisson.">Más</summary>
        <div className="seed-row">
          <NumberField label="Semilla" value={s.seed} min={RANGES.seed[0]} max={RANGES.seed[1]} compact
            tip="La misma semilla y los mismos ajustes siempre generan el mismo patrón. Anótala para repetir un diseño." onChange={seed => change({ seed: Math.round(seed) }, 'seed')} />
          <Button tip="Elige otra semilla aleatoria para crear un patrón con los mismos ajustes." shortcut="G" onClick={onShuffle}>Variar</Button>
        </div>
        <SliderField label="Intentos por punto" value={s.tries} min={RANGES.tries[0]} max={RANGES.tries[1]}
          unavailable={s.placement !== 'even' && 'Los intentos solo se aplican a la distribución Uniforme.'}
          tip="Cantidad de posiciones que prueba la distribución Uniforme alrededor de cada punto. Más intentos dan un relleno más denso, pero tardan más; lo habitual es 30." onChange={tries => change({ tries }, 'tries')} />
      </details>
    </Section>

    <Section title="Gradiente de densidad">
      <Segmented label="Gradiente" hideLabel options={DENSITIES} value={s.density} unavailable={densityOff} onChange={density => change({ density }, 'density')} />
      {densityOff ? <p className="hint">{densityOff}</p> : s.density !== 'none' && <>
        <SliderField label="Intensidad" value={s.densityStrength} min={RANGES.densityStrength[0]} max={RANGES.densityStrength[1]} step={0.5}
          format={v => `${v}×`} tip="Cuántas veces menor es el área de las celdas más pequeñas respecto a las más grandes." onChange={densityStrength => change({ densityStrength }, 'densityStrength')} />
        {s.density === 'linear'
          ? <SliderField label="Dirección" value={s.densityAngle} min={0} max={355} step={5} format={v => `${v}°`}
            tip="Las celdas se hacen más pequeñas en esta dirección. 0° es hacia la derecha y 90° hacia arriba." onChange={densityAngle => change({ densityAngle }, 'densityAngle')} />
          : <Segmented label="Celdas pequeñas en" value={s.densityInvert ? 'edge' : 'centre'} onChange={v => change({ densityInvert: v === 'edge' }, 'densityInvert')}
            options={[{ value: 'centre', label: 'Centro', tip: 'Las celdas más pequeñas se concentran en el centro.' }, { value: 'edge', label: 'Borde', tip: 'Las celdas más pequeñas se concentran en el borde.' }]} />}
      </>}
    </Section>

    <Section title="Relajación">
      <SliderField label="Pasos al generar" value={s.relaxSteps} min={RANGES.relaxSteps[0]} max={RANGES.relaxSteps[1]}
        tip="Pasos de relajación de Lloyd que se aplican a cada patrón nuevo y al pulsar Relajar." onChange={relaxSteps => change({ relaxSteps }, 'relaxSteps')} />
      <p className="hint">Cada paso mueve los puntos al centro de sus celdas. De 1 a 3 pasos dan un aspecto natural y uniforme; muchos pasos lo hacen muy regular. <b>Relajar</b> y <b>Autorrelajar</b> están debajo de la lámina.</p>
    </Section>
  </>
})
