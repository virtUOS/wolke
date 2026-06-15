import { Dialog, Button } from 'wolke-web'

// Dialog is controlled; render it open so the card shows the modal itself.
// cfg.overrides.Dialog pins cardMode:single so the fixed overlay renders inside
// the card instead of escaping it.
export const Open = () => (
  <Dialog
    open
    onOpenChange={() => {}}
    title="Dienst löschen?"
    description="Rechenzentrum wird deaktiviert und verschwindet aus dem Katalog."
    footer={
      <>
        <Button variant="outline">Abbrechen</Button>
        <Button>Löschen</Button>
      </>
    }
  >
    <p style={{ margin: 0, fontSize: 14 }}>Diese Aktion kann von Admins rückgängig gemacht werden.</p>
  </Dialog>
)
