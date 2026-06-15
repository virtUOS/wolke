import { Alert } from 'wolke-web'

const stack = { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 } as const

export const Variants = () => (
  <div style={stack}>
    <Alert variant="info" title="Wartungsfenster">
      Am Sonntag von 02:00–04:00 Uhr stehen einige Dienste nicht zur Verfügung.
    </Alert>
    <Alert variant="warning" title="Zertifikat läuft bald ab">
      Bitte erneuern Sie Ihr Nutzerzertifikat bis Ende des Monats.
    </Alert>
    <Alert variant="danger" title="Störung">Der VPN-Dienst ist derzeit nicht erreichbar.</Alert>
  </div>
)

export const Dismissible = () => (
  <div style={stack}>
    <Alert variant="success" title="Gespeichert" onDismiss={() => {}} dismissLabel="Schließen">
      Ihre Änderungen wurden übernommen.
    </Alert>
  </div>
)
