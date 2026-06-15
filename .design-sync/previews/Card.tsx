import { Card } from 'wolke-web'

export const Default = () => (
  <Card padding="md" elevation="sm" style={{ maxWidth: 320 }}>
    <p style={{ margin: 0, fontWeight: 600 }}>Rechenzentrum</p>
    <p style={{ margin: '4px 0 0', fontSize: 14, opacity: 0.7 }}>
      Zentrale IT-Dienste der Universität.
    </p>
  </Card>
)

export const Interactive = () => (
  <Card padding="md" elevation="sm" interactive style={{ maxWidth: 320 }}>
    <p style={{ margin: 0, fontWeight: 600 }}>Anklickbare Kachel</p>
    <p style={{ margin: '4px 0 0', fontSize: 14, opacity: 0.7 }}>Hebt sich beim Hover.</p>
  </Card>
)
