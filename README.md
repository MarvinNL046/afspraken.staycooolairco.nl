# StayCool Airco - Appointment Booking System

A modern, production-ready appointment booking system for StayCool Airco, built with Next.js 15, TypeScript, and deployed on Netlify.

## 🚀 Features

- **Smart Appointment Booking**: Real-time availability checking with service area validation
- **Multi-step Booking Flow**: User-friendly wizard interface with progress tracking
- **Calendar Integration**: Automatic synchronization with Google Calendar
- **GoHighLevel CRM Integration**: Seamless lead and appointment sync
- **Service Area Validation**: Automatic address validation and travel time calculation
- **Mobile Responsive**: Optimized for all devices
- **Real-time Updates**: Live availability updates using optimistic UI patterns
- **Secure Authentication**: JWT-based booking tokens with session management
- **Email Notifications**: Automated confirmations and reminders
- **Admin Monitoring**: Real-time dashboard for business metrics

## 🛠️ Tech Stack

- **Frontend**: Next.js 15.4.5, React 19, TypeScript
- **Styling**: Tailwind CSS, Radix UI
- **Backend**: Netlify Functions (Serverless)
- **Database**: PostgreSQL (Supabase) with Prisma ORM
- **Cache**: Redis for performance optimization
- **APIs**: Google Maps, Google Calendar, GoHighLevel
- **Testing**: Jest, Playwright, React Testing Library
- **Monitoring**: Datadog, Sentry
- **Deployment**: Netlify with serverless functions

## 📋 Prerequisites

- Node.js 22.16.0 (exact version required)
- npm 10.x
- PostgreSQL database (Supabase recommended)
- Redis instance (optional but recommended)
- Google Cloud Platform account (for Maps and Calendar APIs)
- GoHighLevel account with API access
- Netlify account for deployment

## 🔧 Installation

### 1. Clone the repository
```bash
git clone https://github.com/MarvinNL046/afspraken.staycooolairco.nl.git
cd afspraken.staycooolairco.nl
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up environment variables
```bash
cp .env.example .env.local
```

Fill in all required environment variables in `.env.local`

### 4. Start local services (development)
```bash
# Start database and Redis using Docker
docker compose -f docker-compose.dev.yml up -d

# Check status
docker ps
```

### 5. Set up the database
```bash
npx prisma generate
npx prisma migrate dev
npx prisma db seed
```

### 6. Run the development server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 📁 Project Structure

```
app/                    # Next.js app directory
├── api/               # API routes
├── booking/           # Booking flow pages
├── booking-enhanced/  # Enhanced booking with real-time features
├── admin/             # Admin dashboard
└── components/        # Shared components

components/            # React components
├── booking/          # Booking-specific components
├── ui/               # Reusable UI components
└── shared/           # Shared components

lib/                   # Core functionality
├── services/         # Business logic and API clients
├── utils/            # Utility functions
└── validations/      # Schema validations

netlify/              # Netlify functions
├── functions/        # Serverless functions
└── edge-functions/   # Edge functions

prisma/               # Database
├── schema.prisma     # Database schema
├── migrations/       # Database migrations
└── seed.ts          # Seed data

tests/                # Test files
├── unit/            # Unit tests
├── integration/     # Integration tests
└── e2e/             # End-to-end tests
```

## 🧪 Testing

```bash
# Unit tests
npm run test

# Integration tests
npm run test:integration

# E2E tests (requires running app)
npm run test:e2e

# All tests with coverage
npm run test:all

# Watch mode for development
npm run test:watch
```

## 📦 Build & Deployment

### Local Build
```bash
# Production build
npm run build

# Analyze bundle size
npm run analyze
```

### Deployment to Netlify
```bash
# Deploy to production
npm run deploy:production

# Deploy to staging
npm run deploy:staging
```

The application is configured for automatic deployment via GitHub integration:
- Push to `main` branch → Production deployment
- Push to `develop` branch → Staging deployment

## 🔧 Development Commands

```bash
# Database
npx prisma studio      # Visual database editor
npx prisma migrate dev # Run migrations
npx prisma db push     # Quick schema sync

# Code Quality
npm run lint           # ESLint
npm run typecheck      # TypeScript checking
npm run format         # Prettier formatting

# Docker Services
docker compose -f docker-compose.dev.yml up -d    # Start
docker compose -f docker-compose.dev.yml down     # Stop
docker compose -f docker-compose.dev.yml logs -f  # Logs
```

## 📚 Documentation

- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) - Complete deployment instructions
- [Production Runbook](docs/PRODUCTION_RUNBOOK.md) - Operations and troubleshooting
- [Testing Guide](docs/TESTING_GUIDE.md) - Testing strategies and instructions
- [API Documentation](docs/API_DOCUMENTATION.md) - API endpoints and usage

## 🔒 Security

- All API endpoints are protected with authentication
- Rate limiting implemented on all public endpoints
- CORS configured for production domains only
- Security headers implemented via Netlify configuration
- Input validation and sanitization on all endpoints
- Regular dependency updates and security audits

## 🌍 Environment Variables

Key environment variables (see `.env.example` for full list):

```bash
# Database
DATABASE_URL=
DIRECT_URL=

# Redis
REDIS_URL=

# Authentication
JWT_SECRET_KEY=
ENCRYPTION_KEY=

# Google APIs
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
GOOGLE_CALENDAR_CREDENTIALS=

# GoHighLevel
GOHIGHLEVEL_API_KEY=
GOHIGHLEVEL_WEBHOOK_SECRET=

# Monitoring
SENTRY_DSN=
DD_API_KEY=
```

## 🚀 Production URL

- **Production**: https://afspraken.staycoolairco.nl
- **Health Check**: https://afspraken.staycoolairco.nl/api/health

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is proprietary software for StayCool Airco. All rights reserved.

## 👥 Contact

- **Business**: info@staycoolairco.nl
- **Technical Issues**: Create an issue in this repository

---

Built with ❤️ for StayCool Airco