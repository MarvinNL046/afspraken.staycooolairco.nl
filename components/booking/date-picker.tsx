'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday } from 'date-fns'
import { nl } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface DatePickerProps {
  value?: Date
  onChange: (date: Date) => void
  availableDates: string[]
  minDate?: Date
  maxDate?: Date
}

export function DatePicker({ value, onChange, availableDates, minDate, maxDate }: DatePickerProps) {
  const [currentMonth, setCurrentMonth] = useState(value || new Date())
  
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd })
  
  // Pad the start of the month
  const startPadding = monthStart.getDay()
  const paddedDays = [
    ...Array(startPadding).fill(null),
    ...monthDays
  ]
  
  const isDateAvailable = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd')
    return availableDates.includes(dateStr)
  }
  
  const isDateDisabled = (date: Date) => {
    if (!date) return true
    if (minDate && date < minDate) return true
    if (maxDate && date > maxDate) return true
    return !isDateAvailable(date)
  }
  
  return (
    <div className="w-full max-w-sm">
      <div className="flex items-center justify-between mb-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        
        <h3 className="text-lg font-semibold capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: nl })}
        </h3>
        
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'].map(day => (
          <div key={day} className="text-center text-sm font-medium text-gray-600 py-2">
            {day}
          </div>
        ))}
      </div>
      
      <div className="grid grid-cols-7 gap-1">
        {paddedDays.map((date, index) => (
          <button
            key={index}
            type="button"
            disabled={!date || isDateDisabled(date)}
            onClick={() => date && !isDateDisabled(date) && onChange(date)}
            className={cn(
              "h-10 w-full rounded-md text-sm transition-colors",
              !date && "invisible",
              date && isDateDisabled(date) && "text-gray-300 cursor-not-allowed",
              date && !isDateDisabled(date) && "hover:bg-gray-100 cursor-pointer",
              date && isToday(date) && "font-semibold",
              date && value && isSameDay(date, value) && "bg-blue-600 text-white hover:bg-blue-700",
              date && isDateAvailable(date) && !isSameDay(date, value || new Date()) && "text-gray-900 bg-green-50"
            )}
          >
            {date && format(date, 'd')}
          </button>
        ))}
      </div>
    </div>
  )
}