# StayCool Airco - Comprehensive Testing Guide

This document provides a complete guide to the testing infrastructure, strategies, and best practices for the StayCool Airco appointment booking system.

## Table of Contents

1. [Testing Overview](#testing-overview)
2. [Test Architecture](#test-architecture)
3. [Running Tests](#running-tests)
4. [Writing Tests](#writing-tests)
5. [Test Coverage](#test-coverage)
6. [CI/CD Integration](#cicd-integration)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

## Testing Overview

Our testing strategy follows the testing pyramid principle with comprehensive coverage across:

- **Unit Tests**: Fast, isolated tests for individual functions and components
- **Integration Tests**: API endpoint and service layer testing with real databases
- **E2E Tests**: Full user journey testing across browsers using Playwright
- **Accessibility Tests**: WCAG compliance and usability testing

### Key Technologies

- **Jest**: Unit and integration testing framework
- **Playwright**: E2E and cross-browser testing
- **Testing Library**: React component testing utilities
- **Axe-core**: Accessibility testing
- **Supertest**: HTTP assertion library for API testing

## Test Architecture

```
app-code/
├── __tests__/
│   ├── unit/               # Unit tests for isolated components
│   │   ├── services/       # Service layer unit tests
│   │   ├── utils/          # Utility function tests
│   │   └── components/     # React component tests
│   ├── integration/        # Integration tests
│   │   ├── api/           # API endpoint tests
│   │   └── setup/         # Test environment setup
│   ├── utils/             # Test utilities and helpers
│   └── fixtures/          # Mock data and fixtures
├── e2e/                   # Playwright E2E tests
│   ├── pages/            # Page object models
│   ├── helpers/          # E2E test helpers
│   └── .auth/            # Authentication state storage
├── jest.config.js        # Main Jest configuration
├── jest.config.integration.js # Integration test config
└── playwright.config.ts  # Playwright configuration
```

## Running Tests

### Prerequisites

```bash
# Install dependencies
npm install

# Setup test database (for integration tests)
createdb staycool_test
npm run prisma:migrate:test

# Install Playwright browsers (for E2E tests)
npx playwright install
```

### Test Commands

```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# E2E tests
npm run test:e2e

# E2E tests with UI mode
npm run test:e2e:ui

# Watch mode for development
npm run test:watch

# Generate coverage report
npm run test:coverage

# Run specific test file
npm test -- services/authService.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="should create appointment"
```

### Environment Variables

Create a `.env.test` file for test-specific configuration:

```env
NODE_ENV=test
DATABASE_URL=postgresql://test:test@localhost:5432/staycool_test
REDIS_URL=redis://localhost:6379/1
JWT_SECRET=test-jwt-secret
ENCRYPTION_KEY=test-encryption-key-32-chars-long
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=test-api-key
```

## Writing Tests

### Unit Tests

Unit tests focus on individual functions and components in isolation:

```typescript
// Example: Service unit test
describe('AuthService', () => {
  let mockPrisma: jest.Mocked<PrismaClient>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = new PrismaClient() as jest.Mocked<PrismaClient>;
  });

  describe('register', () => {
    it('should create a new user with hashed password', async () => {
      // Arrange
      const userData = {
        email: 'test@example.com',
        password: 'Test123!',
        name: 'Test User',
      };
      
      // Mock dependencies
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      mockPrisma.user.create = jest.fn().mockResolvedValue({
        id: '123',
        email: userData.email,
        name: userData.name,
      });

      // Act
      const result = await authService.register(userData);

      // Assert
      expect(bcrypt.hash).toHaveBeenCalledWith(userData.password, 12);
      expect(result.email).toBe(userData.email);
    });
  });
});
```

### Integration Tests

Integration tests verify API endpoints with real database connections:

```typescript
// Example: API integration test
describe('POST /api/appointments', () => {
  let authToken: string;
  let testUser: User;

  beforeEach(async () => {
    // Setup test data
    testUser = await createTestUser();
    authToken = generateAuthToken(testUser);
  });

  it('should create appointment with valid data', async () => {
    // Arrange
    const appointmentData = {
      serviceType: 'AC_INSTALLATION',
      address: 'Damrak 70',
      postalCode: '1012LM',
      city: 'Amsterdam',
      scheduledDate: '2024-01-20T10:00:00Z',
    };

    // Act
    const response = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${authToken}`)
      .send(appointmentData);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      serviceType: appointmentData.serviceType,
      status: 'SCHEDULED',
    });
  });
});
```

### E2E Tests

E2E tests simulate real user interactions:

```typescript
// Example: E2E test with page objects
test('complete booking flow', async ({ page }) => {
  const homePage = new HomePage(page);
  const bookingPage = new BookingPage(page);

  // Navigate and start booking
  await homePage.goto();
  await homePage.clickBookNow();

  // Select service
  await bookingPage.selectService('AC_INSTALLATION');
  await bookingPage.clickNext();

  // Fill address
  await bookingPage.fillAddress({
    street: 'Damrak 70',
    postalCode: '1012LM',
    city: 'Amsterdam',
  });
  await bookingPage.clickNext();

  // Continue through flow...
  
  // Verify success
  await expect(page.locator('[data-testid="booking-success"]')).toBeVisible();
});
```

### Test Utilities

Use provided test utilities for consistent test data:

```typescript
import { TestDataGenerator, AuthHelpers, DatabaseHelpers } from '@/__tests__/utils/testHelpers';

// Generate test data
const user = TestDataGenerator.generateUser();
const appointment = TestDataGenerator.generateAppointment(user.id);
const address = TestDataGenerator.generateServiceAreaAddress();

// Authentication helpers
const token = AuthHelpers.generateToken(user);
const headers = AuthHelpers.createAuthHeader(token);

// Database helpers
const dbHelper = new DatabaseHelpers(prisma);
await dbHelper.seedServiceAreas();
await dbHelper.cleanDatabase();
```

## Test Coverage

### Coverage Requirements

- **Global**: 80% minimum coverage
- **Services**: 90% minimum coverage
- **Middleware**: 85% minimum coverage
- **Critical paths**: 95% minimum coverage

### Viewing Coverage Reports

```bash
# Generate HTML coverage report
npm run test:coverage

# Open coverage report
open coverage/lcov-report/index.html
```

### Coverage Configuration

Coverage thresholds are configured in `jest.config.js`:

```javascript
coverageThreshold: {
  global: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80
  },
  './lib/services/**/*.{js,ts}': {
    branches: 90,
    functions: 90,
    lines: 90,
    statements: 90
  }
}
```

## CI/CD Integration

### GitHub Actions

Tests run automatically on:
- Push to `main` or `develop` branches
- Pull request creation/update

Workflow stages:
1. **Unit Tests**: Fast feedback on code quality
2. **Integration Tests**: API and database verification
3. **E2E Tests**: Cross-browser compatibility
4. **Accessibility Tests**: WCAG compliance

### Netlify Integration

Deploy previews include:
- Lighthouse performance testing
- Security header validation
- Function endpoint testing

## Best Practices

### 1. Test Organization

- **Naming**: Use descriptive test names that explain the scenario
- **Structure**: Follow AAA pattern (Arrange, Act, Assert)
- **Isolation**: Each test should be independent
- **Focus**: Test one thing per test case

### 2. Mock Management

```typescript
// Good: Clear mock setup
beforeEach(() => {
  jest.clearAllMocks();
  // Reset specific mocks
});

// Good: Restore mocks after tests
afterEach(() => {
  jest.restoreAllMocks();
});
```

### 3. Async Testing

```typescript
// Good: Proper async handling
it('should handle async operations', async () => {
  await expect(asyncFunction()).resolves.toBe(expectedValue);
});

// Good: Wait for specific conditions
await waitFor(() => {
  expect(screen.getByText('Success')).toBeInTheDocument();
});
```

### 4. Data Management

- Use factories for consistent test data
- Clean up test data after each test
- Use transactions for integration tests when possible

### 5. Performance

- Run unit tests in parallel
- Use test databases for integration tests
- Optimize E2E test selectors

## Troubleshooting

### Common Issues

#### 1. Database Connection Errors

```bash
# Ensure test database exists
createdb staycool_test

# Run migrations
DATABASE_URL=postgresql://test:test@localhost:5432/staycool_test npm run prisma:migrate:deploy
```

#### 2. Playwright Browser Issues

```bash
# Reinstall browsers
npx playwright install --force

# Run with debug mode
PWDEBUG=1 npm run test:e2e
```

#### 3. Flaky Tests

- Add proper wait conditions
- Increase timeouts for slow operations
- Use retry mechanisms for network requests

#### 4. Memory Issues

```bash
# Run with increased memory
NODE_OPTIONS="--max-old-space-size=4096" npm test
```

### Debug Mode

```bash
# Run Jest in debug mode
node --inspect-brk node_modules/.bin/jest --runInBand

# Run Playwright in debug mode
npx playwright test --debug

# Run specific test in watch mode
npm test -- --watch authService.test.ts
```

### Test Maintenance

1. **Regular Updates**: Keep test dependencies updated
2. **Refactoring**: Update tests when code changes
3. **Review**: Include test reviews in PR process
4. **Documentation**: Update this guide when adding new patterns

## Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Testing Library Documentation](https://testing-library.com/docs/)
- [Axe-core Documentation](https://www.deque.com/axe/core-documentation/)

---

For questions or issues with testing, please contact the development team or create an issue in the repository.