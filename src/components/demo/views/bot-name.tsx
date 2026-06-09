'use client'

import { useEffect, useState } from 'react'
import { useDemoStore } from '@/components/demo/store'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

// Editable bot name — persists to the per-browser overlay (appSettings.botName).
export function DemoBotName({ initial }: { initial: string }) {
  const store = useDemoStore()
  const [name, setName] = useState(initial)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (store.overlay.appSettings.botName != null) setName(store.overlay.appSettings.botName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.hydrated])

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        store.setBotName(name)
        setSaved(true)
      }}
    >
      <div className="flex-1 space-y-1">
        <Label htmlFor="botName">Bot name</Label>
        <Input id="botName" value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} minLength={2} maxLength={32} required />
      </div>
      <Button type="submit">Save name</Button>
      {saved && <span className="self-center text-sm text-emerald-500">Saved ✓</span>}
    </form>
  )
}
