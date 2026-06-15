import { Button } from 'wolke-web'

const row = { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' } as const

export const Variants = () => (
  <div style={row}>
    <Button>Speichern</Button>
    <Button variant="outline">Abbrechen</Button>
    <Button variant="ghost">Mehr</Button>
  </div>
)

export const Sizes = () => (
  <div style={row}>
    <Button size="sm">Klein</Button>
    <Button>Normal</Button>
  </div>
)

export const Disabled = () => (
  <div style={row}>
    <Button disabled>Nicht verfügbar</Button>
  </div>
)
