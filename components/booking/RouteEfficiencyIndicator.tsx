'use client'

import { TrendingUp, MapPin, Clock } from 'lucide-react'

interface RouteEfficiencyIndicatorProps {
  efficiency: number
  travelTimeFromPrevious?: number
  travelTimeToNext?: number
  className?: string
}

export function RouteEfficiencyIndicator({ 
  efficiency, 
  travelTimeFromPrevious, 
  travelTimeToNext,
  className = ''
}: RouteEfficiencyIndicatorProps) {
  const getEfficiencyColor = () => {
    if (efficiency >= 80) return 'text-green-600 bg-green-50 border-green-200'
    if (efficiency >= 60) return 'text-blue-600 bg-blue-50 border-blue-200'
    if (efficiency >= 40) return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    return 'text-gray-600 bg-gray-50 border-gray-200'
  }

  const getEfficiencyLabel = () => {
    if (efficiency >= 80) return 'Uitstekende route'
    if (efficiency >= 60) return 'Goede route'
    if (efficiency >= 40) return 'Redelijke route'
    return 'Minder efficiënte route'
  }

  const totalTravelTime = (travelTimeFromPrevious || 0) + (travelTimeToNext || 0)

  return (
    <div className={`rounded-lg border p-3 ${getEfficiencyColor()} ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center">
          <TrendingUp className="w-4 h-4 mr-2" />
          <span className="text-sm font-medium">{getEfficiencyLabel()}</span>
        </div>
        <span className="text-lg font-bold">{efficiency}%</span>
      </div>
      
      {(travelTimeFromPrevious || travelTimeToNext) && (
        <div className="space-y-1 text-xs">
          {travelTimeFromPrevious && (
            <div className="flex items-center">
              <MapPin className="w-3 h-3 mr-1" />
              <span>Reistijd vanaf vorige: {travelTimeFromPrevious} min</span>
            </div>
          )}
          {travelTimeToNext && (
            <div className="flex items-center">
              <MapPin className="w-3 h-3 mr-1" />
              <span>Reistijd naar volgende: {travelTimeToNext} min</span>
            </div>
          )}
          {totalTravelTime > 0 && (
            <div className="flex items-center pt-1 border-t border-current opacity-50">
              <Clock className="w-3 h-3 mr-1" />
              <span>Totale reistijd: {totalTravelTime} min</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}