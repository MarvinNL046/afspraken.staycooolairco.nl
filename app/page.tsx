import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AirVent, Calendar, Shield, Clock, ChevronRight } from 'lucide-react'

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <AirVent className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">StayCool Airco</h1>
                <p className="text-sm text-gray-600">Professionele airconditioning services</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">Bel direct:</p>
              <a href="tel:0612345678" className="text-lg font-semibold text-blue-600 hover:text-blue-700">
                06-12345678
              </a>
            </div>
          </div>
        </div>
      </header>
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">
            Professionele Airconditioning Service<br />
            <span className="text-blue-600">in Limburg</span>
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
            Plan direct online een afspraak voor installatie, onderhoud of reparatie. 
            Onze gecertificeerde monteurs staan voor u klaar.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link href="/booking">
              <Button size="lg" className="min-w-[200px] shadow-lg hover:shadow-xl transition-all">
                <Calendar className="w-5 h-5 mr-2" />
                Plan een afspraak
                <ChevronRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
            <div className="text-gray-600">
              of bel direct <a href="tel:0612345678" className="font-semibold text-blue-600 hover:underline">06-12345678</a>
            </div>
          </div>
        </div>

        {/* Service Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          <div className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow p-6 border border-gray-100">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
              <AirVent className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Installatie</h3>
            <p className="text-gray-600 text-sm mb-4">Vakkundige installatie van nieuwe airco systemen</p>
            <Link href="/booking?service=installatie" className="text-blue-600 hover:text-blue-700 font-medium text-sm flex items-center">
              Meer info <ChevronRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow p-6 border border-gray-100">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
              <Shield className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Onderhoud</h3>
            <p className="text-gray-600 text-sm mb-4">Regelmatig onderhoud voor optimale prestaties</p>
            <Link href="/booking?service=onderhoud" className="text-blue-600 hover:text-blue-700 font-medium text-sm flex items-center">
              Meer info <ChevronRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow p-6 border border-gray-100">
            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Reparatie</h3>
            <p className="text-gray-600 text-sm mb-4">Snelle reparatie bij storingen en defecten</p>
            <Link href="/booking?service=reparatie" className="text-blue-600 hover:text-blue-700 font-medium text-sm flex items-center">
              Meer info <ChevronRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow p-6 border border-gray-100">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Inspectie</h3>
            <p className="text-gray-600 text-sm mb-4">Grondige inspectie en advies op maat</p>
            <Link href="/booking?service=inspectie" className="text-blue-600 hover:text-blue-700 font-medium text-sm flex items-center">
              Meer info <ChevronRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
        </div>
        
        {/* Booking CTA */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-8 md:p-12 text-white text-center mb-16">
          <h2 className="text-3xl font-bold mb-4">Direct een afspraak maken?</h2>
          <p className="text-xl mb-8 text-blue-100">
            Plan binnen 2 minuten uw afspraak online. Kies zelf uw datum en tijd.
          </p>
          <Link href="/booking">
            <Button size="lg" variant="secondary" className="shadow-lg hover:shadow-xl transition-all">
              <Calendar className="w-5 h-5 mr-2" />
              Start online planning
            </Button>
          </Link>
        </div>
        
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Snelle Service</h3>
            <p className="text-gray-600">Meestal binnen 48 uur bij u thuis</p>
          </div>
          
          <div className="text-center">
            <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Gecertificeerd</h3>
            <p className="text-gray-600">Erkend installateur met garantie</p>
          </div>
          
          <div className="text-center">
            <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Eerlijke Prijzen</h3>
            <p className="text-gray-600">Transparante tarieven zonder verrassingen</p>
          </div>
        </div>
      </main>
      
      <footer className="bg-gray-900 text-white mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h4 className="text-lg font-semibold mb-4">Contact</h4>
              <p className="text-gray-400">
                StayCool Airco<br />
                Telefoon: 06-12345678<br />
                Email: info@staycoolairco.nl
              </p>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-4">Services</h4>
              <ul className="space-y-2 text-gray-400">
                <li>Airco installatie</li>
                <li>Onderhoud en service</li>
                <li>Reparaties</li>
                <li>Advies op maat</li>
              </ul>
            </div>
            <div>
              <h4 className="text-lg font-semibold mb-4">Werkgebied</h4>
              <p className="text-gray-400">
                Wij zijn actief in de gehele provincie Limburg.
              </p>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-800 text-center text-gray-400">
            <p>&copy; 2024 StayCool Airco. Alle rechten voorbehouden.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}