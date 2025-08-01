'use client'

import { formatTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { TimeSlotWithAvailability } from '@/lib/types'

interface TimePickerProps {
  value?: string
  onChange: (time: string) => void
  slots: TimeSlotWithAvailability[]
}

export function TimePicker({ value, onChange, slots }: TimePickerProps) {
  if (!slots.length) {
    return (
      <div className="text-center py-8 text-gray-500">
        Geen tijdsloten beschikbaar voor deze datum
      </div>
    )
  }
  
  return (
    <div className="grid grid-cols-3 gap-2">
      {slots.map((slot) => (
        <button
          key={slot.id}
          type="button"
          disabled={!slot.available}
          onClick={() => slot.available && onChange(slot.startTime)}
          className={cn(
            "rounded-md px-4 py-2 text-sm font-medium transition-colors",
            slot.available && "hover:bg-gray-100 border border-gray-300",
            !slot.available && "bg-gray-100 text-gray-400 cursor-not-allowed",
            value === slot.startTime && slot.available && "bg-blue-600 text-white hover:bg-blue-700 border-blue-600"
          )}
        >
          {formatTime(slot.startTime)}
        </button>
      ))}
    </div>
  )
}