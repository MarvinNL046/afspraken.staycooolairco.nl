'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, isBefore, startOfDay } from 'date-fns'
import { nl } from 'date-fns/locale'

interface MobileCalendarProps {
  selectedDate: Date | null
  onSelectDate: (date: Date) => void
  availableDates: Set<string>
}

export function MobileCalendar({ selectedDate, onSelectDate, availableDates }: MobileCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd })

  // Add padding days for consistent grid
  const startDayOfWeek = monthStart.getDay()
  const paddingDaysStart = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1
  const paddingDaysEnd = 42 - (paddingDaysStart + monthDays.length)

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1))
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1))

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={handlePrevMonth}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
        
        <h2 className="text-lg font-semibold text-gray-900">
          {format(currentMonth, 'MMMM yyyy', { locale: nl })}
        </h2>
        
        <button
          onClick={handleNextMonth}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {/* Day Labels */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].map((day) => (
          <div key={day} className="text-center text-xs font-medium text-gray-500 py-2">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Padding days at start */}
        {Array.from({ length: paddingDaysStart }).map((_, index) => (
          <div key={`start-${index}`} className="aspect-square" />
        ))}

        {/* Month days */}
        {monthDays.map((date) => {
          const dateKey = format(date, 'yyyy-MM-dd')
          const isAvailable = availableDates.has(dateKey)
          const isPast = isBefore(date, startOfDay(new Date()))
          const isSelected = selectedDate && isSameDay(date, selectedDate)
          const isCurrentDay = isToday(date)

          return (
            <button
              key={dateKey}
              onClick={() => isAvailable && !isPast && onSelectDate(date)}
              disabled={!isAvailable || isPast}
              className={`
                aspect-square rounded-lg flex items-center justify-center text-sm font-medium
                transition-all duration-200 relative
                ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-md scale-105'
                    : isPast
                    ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                    : !isAvailable
                    ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                    : isCurrentDay
                    ? 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'
                    : 'bg-white hover:bg-gray-50 text-gray-900 border border-gray-100'
                }
              `}
            >
              {format(date, 'd')}
              {isAvailable && !isPast && (
                <span className="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-green-500 rounded-full" />
              )}
            </button>
          )
        })}

        {/* Padding days at end */}
        {Array.from({ length: paddingDaysEnd }).map((_, index) => (
          <div key={`end-${index}`} className="aspect-square" />
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center justify-center space-x-4 text-xs text-gray-600">
        <div className="flex items-center">
          <span className="w-3 h-3 bg-green-500 rounded-full mr-1" />
          <span>Beschikbaar</span>
        </div>
        <div className="flex items-center">
          <span className="w-3 h-3 bg-gray-300 rounded-full mr-1" />
          <span>Niet beschikbaar</span>
        </div>
      </div>
    </div>
  )
}