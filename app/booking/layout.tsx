import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Afspraak Maken | StayCool Airco',
  description: 'Plan uw afspraak voor airconditioning service',
}

export default function BookingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-50">
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <a href="/" className="flex items-center space-x-2 text-gray-900 hover:text-blue-600 transition-colors">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="font-medium">Terug naar home</span>
            </a>
            <div className="text-sm text-gray-600">
              Hulp nodig? Bel <a href="tel:0612345678" className="font-semibold text-blue-600">06-12345678</a>
            </div>
          </div>
        </div>
      </div>
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}