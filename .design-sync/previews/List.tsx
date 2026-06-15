import { List, ListItem, Badge } from 'wolke-web'

export const Default = () => (
  <List style={{ maxWidth: 420 }}>
    <ListItem>
      <span style={{ flex: 1, fontWeight: 500 }}>Rechenzentrum</span>
      <Badge variant="success">aktiv</Badge>
    </ListItem>
    <ListItem>
      <span style={{ flex: 1, fontWeight: 500 }}>StudIP</span>
      <Badge>inaktiv</Badge>
    </ListItem>
    <ListItem>
      <span style={{ flex: 1, fontWeight: 500 }}>VPN</span>
      <Badge variant="warning">Wartung</Badge>
    </ListItem>
  </List>
)
