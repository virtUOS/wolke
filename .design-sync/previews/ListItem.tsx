import { List, ListItem } from 'wolke-web'

// ListItem only renders meaningfully inside a List, so its preview composes the parent.
export const InList = () => (
  <List style={{ maxWidth: 420 }}>
    <ListItem>
      <span style={{ flex: 1 }}>Erste Zeile</span>
      <span style={{ fontSize: 12, opacity: 0.7 }}>Detail</span>
    </ListItem>
    <ListItem>
      <span style={{ flex: 1 }}>Zweite Zeile</span>
      <span style={{ fontSize: 12, opacity: 0.7 }}>Detail</span>
    </ListItem>
  </List>
)
