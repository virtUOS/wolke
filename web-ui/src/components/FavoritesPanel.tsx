import { useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { Category, FavoriteList, Service } from '@/lib/api'
import { Tile } from './Tile'

type TileBag = {
  service: Service
  categories: Category[]
  locale: string
  favorited: boolean
  onToggleFavorite: (s: Service) => void
  onAddToList: (s: Service) => void
  onLaunch: (s: Service) => void
}

interface FavoritesPanelProps {
  lists: FavoriteList[]
  frequent: Service[]
  resolve: (id: string) => Service | undefined
  categories: Category[]
  locale: string
  view: 'list' | 'table'
  defaultListID: string | null
  favoritedIDs: Set<string>
  onCreateList: (name: string) => void
  onRenameList: (id: string, name: string) => void
  onDeleteList: (id: string) => void
  onReorderList: (id: string, sort: number) => void
  onRemoveItem: (listID: string, serviceID: string) => void
  onToggleFavorite: (service: Service) => void
  onAddToList: (service: Service) => void
  onLaunch: (service: Service) => void
}

export function FavoritesPanel(props: FavoritesPanelProps) {
  const { lists, frequent, resolve, categories, locale, view } = props
  const grid = view === 'table' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-3'

  const tileProps = (s: Service): TileBag => ({
    service: s,
    categories,
    locale,
    favorited: props.favoritedIDs.has(s.id),
    onToggleFavorite: props.onToggleFavorite,
    onAddToList: props.onAddToList,
    onLaunch: props.onLaunch,
  })

  return (
    <div className="space-y-10">
      {frequent.length > 0 && (
        <section aria-labelledby="frequent">
          <h2 id="frequent" className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
            <span aria-hidden="true" className="inline-block h-4 w-1 rounded bg-primary" />
            Häufig genutzt
          </h2>
          <div className={grid}>
            {frequent.map((s) => (
              <Tile key={`freq-${s.id}`} {...tileProps(s)} />
            ))}
          </div>
        </section>
      )}

      <NewListForm onCreate={props.onCreateList} />

      {lists.length === 0 ? (
        <p className="text-sm text-text-muted">Noch keine Liste. Tippe ☆ auf einem Dienst oder lege oben eine Liste an.</p>
      ) : (
        lists.map((list, i) => (
          <ListSection
            key={list.id}
            list={list}
            isFirst={i === 0}
            isLast={i === lists.length - 1}
            prev={lists[i - 1]}
            next={lists[i + 1]}
            grid={grid}
            resolve={resolve}
            tileProps={tileProps}
            onRename={props.onRenameList}
            onDelete={props.onDeleteList}
            onReorder={props.onReorderList}
            onRemoveItem={props.onRemoveItem}
          />
        ))
      )}
    </div>
  )
}

function NewListForm({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const n = name.trim()
        if (n) {
          onCreate(n)
          setName('')
        }
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Neue Liste…"
        maxLength={60}
        aria-label="Name der neuen Liste"
        className="h-9 w-56 rounded-md border border-surface bg-surface px-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      />
      <button
        type="submit"
        disabled={name.trim() === ''}
        aria-label="Liste erstellen"
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> Liste
      </button>
    </form>
  )
}

interface ListSectionProps {
  list: FavoriteList
  isFirst: boolean
  isLast: boolean
  prev?: FavoriteList
  next?: FavoriteList
  grid: string
  resolve: (id: string) => Service | undefined
  tileProps: (s: Service) => TileBag
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onReorder: (id: string, sort: number) => void
  onRemoveItem: (listID: string, serviceID: string) => void
}

function ListSection({ list, isFirst, isLast, prev, next, grid, resolve, tileProps, onRename, onDelete, onReorder, onRemoveItem }: ListSectionProps) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(list.name)
  const services = list.items.map(resolve).filter((s): s is Service => Boolean(s))

  // Swap sort with the adjacent list to move this one up/down.
  const move = (neighbor?: FavoriteList) => {
    if (!neighbor) return
    onReorder(list.id, neighbor.sort)
    onReorder(neighbor.id, list.sort)
  }

  return (
    <section aria-labelledby={`list-${list.id}`}>
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-5 w-1 rounded bg-primary" />
        {editing ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const n = name.trim()
              if (n) onRename(list.id, n)
              setEditing(false)
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Listenname"
              maxLength={60}
              autoFocus
              className="h-8 rounded-md border border-surface bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            />
            <button type="submit" className="text-sm text-primary hover:text-primary-hover">Speichern</button>
          </form>
        ) : (
          <h2 id={`list-${list.id}`} className="text-lg font-semibold">
            {list.name}
          </h2>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <IconBtn label="Nach oben" disabled={isFirst} onClick={() => move(prev)}>
            <ChevronUp className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Nach unten" disabled={isLast} onClick={() => move(next)}>
            <ChevronDown className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Liste umbenennen" onClick={() => { setName(list.name); setEditing(true) }}>
            <Pencil className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Liste löschen" onClick={() => onDelete(list.id)}>
            <Trash2 className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>

      {services.length === 0 ? (
        <p className="text-sm text-text-muted">Diese Liste ist leer.</p>
      ) : (
        <div className={grid}>
          {services.map((s) => (
            <div key={`${list.id}-${s.id}`} className="space-y-1">
              <Tile {...tileProps(s)} />
              <button
                type="button"
                onClick={() => onRemoveItem(list.id, s.id)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                <X className="h-3 w-3" aria-hidden="true" /> Aus „{list.name}" entfernen
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-text-muted hover:bg-surface hover:text-text disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
    >
      {children}
    </button>
  )
}
