'use client'

// A button that opens a dropdown of options; picking one submits a server
// action (used for Assign + Move-category on the ticket detail page). Each
// item is its own tiny form so the bound server action receives the chosen
// value via a hidden input — no client state needed.

import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type MenuOption = { value: string; label: string }

export function TicketActionMenu({
  triggerLabel,
  name,
  options,
  currentValue,
  action,
  variant = 'outline',
}: {
  triggerLabel: string
  name: string
  options: MenuOption[]
  currentValue?: string | null
  action: (formData: FormData) => void | Promise<void>
  variant?: 'secondary' | 'outline'
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant={variant}>
          {triggerLabel}
          <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 min-w-48 overflow-y-auto">
        {options.map((o) => (
          <form key={o.value || '__none'} action={action}>
            <input type="hidden" name={name} value={o.value} />
            <DropdownMenuItem asChild>
              <button type="submit" className="flex w-full cursor-pointer items-center justify-between">
                <span className="truncate">{o.label}</span>
                {currentValue != null && o.value === currentValue && (
                  <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />
                )}
              </button>
            </DropdownMenuItem>
          </form>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
