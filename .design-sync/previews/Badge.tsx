import { Badge } from 'wolke-web'

const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } as const

export const Variants = () => (
  <div style={row}>
    <Badge>neutral</Badge>
    <Badge variant="info">info</Badge>
    <Badge variant="success">aktiv</Badge>
    <Badge variant="warning">Warnung</Badge>
    <Badge variant="danger">kritisch</Badge>
  </div>
)
